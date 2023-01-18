import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { assertNever, stringifyError } from '@sofie-package-manager/api'
import { EvaluationRunner } from './evaluationRunner'
import { ExpectationManager } from './expectationManager'
import { ExpectationTracker, expLabel, TrackedExpectation } from './expectationTracker'
import { TrackedWorkerAgent } from './helpers/trackedWorkerAgents'

/** Evaluate the state of an Expectation */
export async function evaluateExpectationState(
	runner: EvaluationRunner,
	trackedExp: TrackedExpectation
): Promise<void> {
	const manager: ExpectationManager = runner.manager
	const tracker: ExpectationTracker = runner.tracker

	const timeSinceLastEvaluation = Date.now() - trackedExp.lastEvaluationTime
	if (!trackedExp.session) trackedExp.session = {}
	if (trackedExp.session.hadError) return // There was an error during the session.

	if (trackedExp.session.expectationCanBeRemoved) return // The expectation has been removed

	const workerAgents = manager.workerAgents.list()

	const context: EvaluateContext = {
		manager,
		tracker,
		runner,
		trackedExp,
		workerAgents,
		timeSinceLastEvaluation,
	}
	try {
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW) {
			await evaluateExpectationStateNew(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
			await evaluateExpectationStateWaiting(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.READY) {
			await evaluateExpectationStateReady(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
			await evaluateExpectationStateWorking(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
			await evaluateExpectationStateFulfilled(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.REMOVED) {
			await evaluateExpectationStateRemoved(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.RESTARTED) {
			await evaluateExpectationStateRestarted(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.ABORTED) {
			await evaluateExpectationStateAborted(context)
		} else {
			assertNever(trackedExp.state)
		}
	} catch (err) {
		runner.logger.error(
			`Error thrown in evaluateExpectationState for expectation "${expLabel(trackedExp)}": ${stringifyError(err)}`
		)
		tracker.updateTrackedExpStatus(trackedExp, {
			reason: {
				user: 'Internal error in Package Manager',
				tech: `${stringifyError(err)}`,
			},
			isError: true,
		})
	}
}
interface EvaluateContext {
	manager: ExpectationManager
	tracker: ExpectationTracker
	runner: EvaluationRunner
	trackedExp: TrackedExpectation
	workerAgents: {
		workerId: string
		workerAgent: TrackedWorkerAgent
	}[]
	timeSinceLastEvaluation: number
}

async function evaluateExpectationStateNew({ tracker, trackedExp, workerAgents }: EvaluateContext): Promise<void> {
	// Check which workers might want to handle it:
	// Reset properties:
	trackedExp.status = {}

	let hasQueriedAnyone = false
	await Promise.all(
		workerAgents.map(async ({ workerId, workerAgent }) => {
			if (!workerAgent.connected) return

			// Only ask each worker once:
			if (
				!trackedExp.queriedWorkers[workerId] ||
				Date.now() - trackedExp.queriedWorkers[workerId] > tracker.constants.WORKER_SUPPORT_TIME
			) {
				trackedExp.queriedWorkers[workerId] = Date.now()
				hasQueriedAnyone = true
				try {
					const support = await workerAgent.api.doYouSupportExpectation(trackedExp.exp)

					if (support.support) {
						trackedExp.availableWorkers[workerId] = true
					} else {
						delete trackedExp.availableWorkers[workerId]
						trackedExp.noAvailableWorkersReason = support.reason
					}
				} catch (err) {
					delete trackedExp.availableWorkers[workerId]

					if ((err + '').match(/timeout/i)) {
						trackedExp.noAvailableWorkersReason = {
							user: 'Worker timed out',
							tech: `Worker "${workerId} timeout"`,
						}
					} else throw err
				}
			}
		})
	)
	const availableWorkersCount = Object.keys(trackedExp.availableWorkers).length
	if (availableWorkersCount) {
		if (hasQueriedAnyone) {
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
				reason: {
					user: `${availableWorkersCount} workers available, about to start...`,
					tech: `Found ${availableWorkersCount} workers who supports this Expectation`,
				},
				// Don't update the package status, since we don't know anything about the package yet:
				dontUpdatePackage: true,
			})
		} else {
			// If we didn't query anyone, just skip ahead to next state without being too verbose:
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
				// Don't update the package status, since we don't know anything about the package yet:
				dontUpdatePackage: true,
			})
		}
	} else {
		if (!Object.keys(trackedExp.queriedWorkers).length) {
			if (!workerAgents.length) {
				tracker.updateTrackedExpStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					reason: {
						user: `No Workers available (this is likely a configuration issue)`,
						tech: `No Workers available`,
					},
					// Don't update the package status, since we don't know anything about the package yet:
					dontUpdatePackage: true,
				})
			} else {
				tracker.updateTrackedExpStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					reason: {
						user: `No Workers available (this is likely a configuration issue)`,
						tech: `No Workers queried, ${workerAgents.length} available`,
					},
					// Don't update the package status, since we don't know anything about the package yet:
					dontUpdatePackage: true,
				})
			}
		} else {
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: `Found no workers who supports this Expectation, due to: ${trackedExp.noAvailableWorkersReason.user}`,
					tech: `Found no workers who supports this Expectation: "${
						trackedExp.noAvailableWorkersReason.tech
					}", have asked workers: [${Object.keys(trackedExp.queriedWorkers).join(',')}]`,
				},
				// Don't update the package status, since we don't know anything about the package yet:
				dontUpdatePackage: true,
			})
		}
	}
}

async function evaluateExpectationStateWaiting({
	manager,
	tracker,
	runner,
	trackedExp,
}: EvaluateContext): Promise<void> {
	// Check if the expectation is ready to start:
	if (!trackedExp.session) trackedExp.session = {}
	await manager.assignWorkerToSession(trackedExp)

	if (trackedExp.session.assignedWorker) {
		try {
			// First, check if it is already fulfilled:
			const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFullfilled(
				trackedExp.exp,
				false
			)
			if (fulfilled.fulfilled) {
				// The expectation is already fulfilled:
				tracker.updateTrackedExpStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
				})
				if (tracker.onExpectationFullfilled(trackedExp)) {
					// Something was triggered, run again ASAP:
					trackedExp.session.triggerOtherExpectationsAgain = true
				}
			} else {
				const readyToStart = await tracker.isExpectationReadyToStartWorkingOn(
					trackedExp.session.assignedWorker.worker,
					trackedExp
				)

				const newStatus: Partial<TrackedExpectation['status']> = {}
				if (readyToStart.sourceExists !== undefined) newStatus.sourceExists = readyToStart.sourceExists

				if (readyToStart.ready) {
					tracker.updateTrackedExpStatus(trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.READY,
						reason: {
							user: 'About to start working..',
							tech: `About to start, was not fulfilled: ${fulfilled.reason.tech}`,
						},
						status: newStatus,
					})
				} else {
					// Not ready to start
					tracker.updateTrackedExpStatus(trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: readyToStart.reason,
						status: newStatus,
						isError: !readyToStart.isWaitingForAnother,
					})
				}
			}
		} catch (error) {
			// There was an error, clearly it's not ready to start
			runner.logger.warn(`Error in WAITING: ${stringifyError(error)}`)

			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: 'Restarting due to error',
					tech: `Error from worker ${trackedExp.session.assignedWorker.id}: "${stringifyError(error)}"`,
				},
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		tracker.noWorkerAssigned(trackedExp)
	}
}
async function evaluateExpectationStateReady({ manager, tracker, runner, trackedExp }: EvaluateContext): Promise<void> {
	// Start working on it:

	if (!trackedExp.session) trackedExp.session = {}
	await manager.assignWorkerToSession(trackedExp)

	if (
		trackedExp.session.assignedWorker &&
		// Only allow starting if the job can start in a short while:
		trackedExp.session.assignedWorker.cost.startCost > 0 // 2022-03-25: We're setting this to 0 to only allow one job per worker
	) {
		trackedExp.session.noAssignedWorkerReason = {
			user: `Workers are busy`,
			tech: `Workers are busy (startCost=${trackedExp.session.assignedWorker.cost.startCost})`,
		}
		delete trackedExp.session.assignedWorker
	}
	if (trackedExp.session.assignedWorker) {
		const assignedWorker = trackedExp.session.assignedWorker

		try {
			runner.logger.debug(`workOnExpectation: "${expLabel(trackedExp)}" (${trackedExp.exp.type})`)

			// Start working on the Expectation:
			const wipInfo = await assignedWorker.worker.workOnExpectation(
				trackedExp.exp,
				assignedWorker.cost,
				tracker.constants.WORK_TIMEOUT_TIME
			)

			trackedExp.status.workInProgressCancel = async () => {
				await assignedWorker.worker.cancelWorkInProgress(wipInfo.wipId)
				delete trackedExp.status.workInProgressCancel
			}

			// trackedExp.status.workInProgress = new WorkInProgressReceiver(wipInfo.properties)
			tracker.worksInProgress.upsert(assignedWorker.id, wipInfo.wipId, {
				wipId: wipInfo.wipId,
				properties: wipInfo.properties,
				trackedExp: trackedExp,
				workerId: assignedWorker.id,
				worker: assignedWorker.worker,
				cost: assignedWorker.cost.cost,
				startCost: assignedWorker.cost.startCost,
				lastUpdated: Date.now(),
			})

			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.WORKING,
				reason: {
					user: `Working on: ${wipInfo.properties.workLabel}`,
					tech: `Working on: ${wipInfo.properties.workLabel}`,
				},
				status: wipInfo.properties,
			})
		} catch (error) {
			runner.logger.warn(`Error in READY: ${stringifyError(error)}`)
			// There was an error
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: 'Restarting due to an error',
					tech: `Error from worker ${trackedExp.session.assignedWorker.id}: "${stringifyError(error)}"`,
				},
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Check if anough time has passed if it makes sense to check for new workers again:

		if (
			trackedExp.noWorkerAssignedTime &&
			Date.now() - trackedExp.noWorkerAssignedTime > tracker.constants.WORKER_SUPPORT_TIME
		) {
			// Restart
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				// Don't update the package status, since we don't know anything about the package at this point:
				dontUpdatePackage: true,
			})
		} else {
			// Do nothing, hopefully some will be available at a later iteration
			tracker.noWorkerAssigned(trackedExp)
		}
	}
}
async function evaluateExpectationStateWorking(_context: EvaluateContext): Promise<void> {
	// It is already working, don't do anything
	// TODO: work-timeout?
}
async function evaluateExpectationStateFulfilled({
	manager,
	tracker,
	runner,
	trackedExp,
	timeSinceLastEvaluation,
}: EvaluateContext): Promise<void> {
	// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore?

	if (timeSinceLastEvaluation > tracker.getFullfilledWaitTime()) {
		if (!trackedExp.session) trackedExp.session = {}
		await manager.assignWorkerToSession(trackedExp)
		if (trackedExp.session.assignedWorker) {
			try {
				// Check if it is still fulfilled:
				const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFullfilled(
					trackedExp.exp,
					true
				)
				if (fulfilled.fulfilled) {
					// Yes it is still fullfiled
					// No need to update the tracked state, since it's already fullfilled:
					// this.updateTrackedExp(trackedExp, WorkStatusState.FULFILLED, fulfilled.reason)
				} else {
					// It appears like it's not fullfilled anymore
					trackedExp.status.actualVersionHash = undefined
					trackedExp.status.workProgress = undefined
					tracker.updateTrackedExpStatus(trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: fulfilled.reason,
					})
				}
			} catch (error) {
				runner.logger.warn(`Error in FULFILLED: ${stringifyError(error)}`)
				// Do nothing, hopefully some will be available at a later iteration
				// todo: Is this the right thing to do?
				tracker.updateTrackedExpStatus(trackedExp, {
					reason: {
						user: `Can't check if fulfilled, due to an error`,
						tech: `Error from worker ${trackedExp.session.assignedWorker.id}: ${stringifyError(error)}`,
					},
					// Should we se this here?
					// dontUpdatePackage: true,
				})
			}
		} else {
			// No worker is available at the moment.
			// Do nothing, hopefully some will be available at a later iteration
			tracker.noWorkerAssigned(trackedExp)
		}
	} else {
		// Do nothing
	}
}
async function evaluateExpectationStateRemoved({ manager, tracker, trackedExp }: EvaluateContext): Promise<void> {
	/** When true, the expectation can be removed */
	let removeTheExpectation = false

	if (!trackedExp.session) trackedExp.session = {}
	await manager.assignWorkerToSession(trackedExp)
	if (trackedExp.session.assignedWorker) {
		const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
		// Check if the removal was successful:
		if (removed.removed) {
			removeTheExpectation = true
		} else {
			// Something went wrong when trying to handle the removal.
			trackedExp.errorOnRemoveCount++
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
				reason: removed.reason,
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		trackedExp.errorOnRemoveCount++
		tracker.noWorkerAssigned(trackedExp)
	}

	// We only allow a number of failure-of-removals.
	// After that, we'll remove the expectation to avoid congestion:
	if (trackedExp.errorOnRemoveCount > tracker.constants.FAILED_REMOVE_COUNT) {
		removeTheExpectation = true
	}
	if (removeTheExpectation) {
		trackedExp.session.expectationCanBeRemoved = true
		// Send a status that this expectation has been removed:
		manager.updatePackageContainerPackageStatus(trackedExp, true)
		manager.callbacks.reportExpectationStatus(trackedExp.id, null, null, {})
	}
}
async function evaluateExpectationStateRestarted({ manager, tracker, trackedExp }: EvaluateContext): Promise<void> {
	if (!trackedExp.session) trackedExp.session = {}
	await manager.assignWorkerToSession(trackedExp)
	if (trackedExp.session.assignedWorker) {
		// Start by removing the expectation
		const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
		if (removed.removed) {
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: 'Ready to start (after restart)',
					tech: 'Ready to start (after restart)',
				},
			})
		} else {
			// Something went wrong when trying to remove
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
				reason: removed.reason,
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		tracker.noWorkerAssigned(trackedExp)
	}
}
async function evaluateExpectationStateAborted({ manager, tracker, trackedExp }: EvaluateContext): Promise<void> {
	if (!trackedExp.session) trackedExp.session = {}
	await manager.assignWorkerToSession(trackedExp)
	if (trackedExp.session.assignedWorker) {
		// Start by removing the expectation
		const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
		if (removed.removed) {
			// This will cause the expectation to be intentionally stuck in the ABORTED state.
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
				reason: {
					user: 'Aborted',
					tech: 'Aborted',
				},
			})
		} else {
			// Something went wrong when trying to remove
			tracker.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
				reason: removed.reason,
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		tracker.noWorkerAssigned(trackedExp)
	}
}
