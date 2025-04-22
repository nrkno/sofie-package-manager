// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import {
	diff,
	ExpectationId,
	literal,
	LoggerInstance,
	objectEntries,
	objectSize,
	Reason,
	StatusCode,
	stringifyError,
	startTimer,
} from '@sofie-package-manager/api'
import { PromisePool } from '@supercharge/promise-pool'
import _ from 'underscore'
import { evaluateExpectationState } from './evaluateExpectationState'
import { InternalManager } from '../internalManager/internalManager'
import { ExpectationTracker } from '../expectationTracker/expectationTracker'
import { expLabel, getDefaultTrackedExpectation, TrackedExpectation } from '../lib/trackedExpectation'
import { TrackedPackageContainerExpectation } from '../lib/trackedPackageContainerExpectation'

/**
 * The EvaluationRunner goes through one pass of evaluation of expectations.
 * When an evaluation is scheduled to run,
 * a new instance of EvaluationRunner is created, then the async .run() method is called.
 * After .run() is done, the instance is not used again.
 */
export class EvaluationRunner {
	static instanceId = 0

	public logger: LoggerInstance
	private instanceId: number

	constructor(logger: LoggerInstance, public manager: InternalManager, public tracker: ExpectationTracker) {
		this.instanceId = EvaluationRunner.instanceId++
		this.logger = logger.category(`Runner_${this.instanceId}`)
	}
	public async run(): Promise<EvaluationResult> {
		this.logger.debug(Date.now() / 1000 + ' _evaluateExpectations ----------')

		const times: { [key: string]: number } = {}

		{
			const timer = startTimer()

			// First we're going to see if there is any new incoming data which needs to be pulled in.
			if (this.tracker.receivedUpdates.expectationsHasBeenUpdated) {
				await this.updateReceivedData_Expectations().promise
			}
			times['timeUpdateReceivedExpectations'] = timer.get()
		}

		{
			const timer = startTimer()

			if (this.tracker.receivedUpdates.packageContainersHasBeenUpdated) {
				await this._updateReceivedData_TrackedPackageContainers()
			}
			times['timeUpdateReceivedPackageContainerExpectations'] = timer.get()
		}

		{
			const timer = startTimer()

			// Iterate through the PackageContainerExpectations:
			await this._evaluateAllTrackedPackageContainers()
			times['timeEvaluateAllTrackedPackageContainers'] = timer.get()
		}

		{
			const timer = startTimer()

			this.tracker.worksInProgress.checkWorksInProgress()
			times['timeMonitorWorksInProgress'] = timer.get()
		}

		// Iterate through all Expectations:
		const { runAgainASAP, times: evaluateTimes } = await this._evaluateAllExpectations()

		for (const key in evaluateTimes) {
			times[key] = evaluateTimes[key]
		}

		await this.tracker.scaler.checkIfNeedToScaleUp().catch((err) => {
			this.logger.error(`Error in checkIfNeedToScaleUp: ${stringifyError(err)}`)
		})

		this.manager.statusReport.update(times)

		return literal<EvaluationResult>({
			runAgainASAP,
		})
	}
	/** Goes through the incoming data and stores it */
	private updateReceivedData_Expectations(): {
		promise: Promise<void>
	} {
		this.tracker.receivedUpdates.expectationsHasBeenUpdated = false

		const cancelPromises: Promise<void>[] = []

		// Added / Changed Expectations
		for (const exp of this.tracker.receivedUpdates.getExpectations()) {
			let diffExplanation: string | null = null

			let difference: null | 'new' | 'major' | 'minor' = null
			const existingTrackedExp = this.tracker.trackedExpectations.get(exp.id)
			if (!existingTrackedExp) {
				// new
				difference = 'new'
			} else {
				// Treat differences in priority as a "minor" update:
				diffExplanation = diff(existingTrackedExp.exp, exp, ['priority'])
				const isSignificantlyDifferent = Boolean(diffExplanation)
				const isPriorityDifferent = existingTrackedExp.exp.priority !== exp.priority

				if (isSignificantlyDifferent) {
					const trackedExp = existingTrackedExp

					if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						if (trackedExp.status.workInProgressCancel) {
							this.logger.debug(`Cancelling ${expLabel(trackedExp)} due to update`)
							cancelPromises.push(trackedExp.status.workInProgressCancel())
						}
					}
					difference = 'major'
				} else if (isPriorityDifferent) {
					difference = 'minor'
				}
			}

			if (difference === 'new' || difference === 'major') {
				const newTrackedExp = getDefaultTrackedExpectation(exp, existingTrackedExp)

				this.tracker.trackedExpectations.upsert(exp.id, newTrackedExp)
				if (difference === 'new') {
					this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(newTrackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: {
							user: `Added just now`,
							tech: `Added ${Date.now()}`,
						},
						// Don't update the package status, since we don't know anything about the package yet.
						dontUpdatePackage: true,
					})
				} else {
					this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(newTrackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: {
							user: `Updated just now`,
							tech: `Updated ${Date.now()}, diff: (${diffExplanation})`,
						},
						// Don't update the package status, since the package likely hasn't changed:
						dontUpdatePackage: true,
					})
				}
			} else if (difference === 'minor') {
				// A minor update doesn't require a full re-evaluation of the expectation.

				const trackedExp = this.tracker.trackedExpectations.get(exp.id)
				if (trackedExp) {
					this.logger.debug(
						`Minor update of expectation "${expLabel(trackedExp)}": ${diff(existingTrackedExp?.exp, exp)}`
					)

					trackedExp.exp = exp
				}
			}
		}

		// Removed Expectations:
		for (const id of this.tracker.trackedExpectations.getIds()) {
			const trackedExp = this.tracker.trackedExpectations.get(id)
			if (!trackedExp) continue
			trackedExp.errorCount = 0 // Also reset the errorCount, to start fresh.

			if (!this.tracker.receivedUpdates.expectationExist(id)) {
				// This expectation has been removed
				// TODO: handled removed expectations!

				if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.verbose(`Cancelling ${expLabel(trackedExp)} due to removed`)
						cancelPromises.push(trackedExp.status.workInProgressCancel())
					}
				}

				this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
					reason: {
						user: 'Expectation was removed',
						tech: `Expectation was removed`,
					},
				})
				trackedExp.lastEvaluationTime = 0 // To rerun ASAP
			}
		}

		// Restarted Expectations:
		if (this.tracker.receivedUpdates.restartAllExpectations) {
			for (const id of this.tracker.trackedExpectations.getIds()) {
				this.tracker.receivedUpdates.restartExpectations(id)
			}
		}
		this.tracker.receivedUpdates.restartAllExpectations = false

		for (const id of this.tracker.receivedUpdates.getRestartExpectations()) {
			const trackedExp = this.tracker.trackedExpectations.get(id)
			if (trackedExp) {
				if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.verbose(`Cancelling ${expLabel(trackedExp)} due to restart`)
						cancelPromises.push(trackedExp.status.workInProgressCancel())
					}
				}

				this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
					reason: {
						user: 'Restarted by user',
						tech: `Restarted by user`,
					},
					// Don't update the package status, since the package likely hasn't changed:
					dontUpdatePackage: true,
				})
				trackedExp.lastEvaluationTime = 0 // To rerun ASAP
			}
		}
		this.tracker.receivedUpdates.clearRestartExpectations()

		// Aborted:
		for (const id of this.tracker.receivedUpdates.getAbortExpectations()) {
			const trackedExp = this.tracker.trackedExpectations.get(id)
			if (trackedExp) {
				if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.verbose(`Cancelling ${expLabel(trackedExp)} due to abort`)
						cancelPromises.push(trackedExp.status.workInProgressCancel())
					}
				}

				this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
					reason: {
						user: 'Aborted by user',
						tech: `Aborted by user`,
					},
					// Don't update the package status, since the package likely hasn't changed:
					dontUpdatePackage: true,
				})
			}
		}
		this.tracker.receivedUpdates.clearAbortExpectations()

		// We have now handled all new updates:
		this.tracker.receivedUpdates.expectationsHasBeenUpdated = false

		// Recalculate the tree of listening expectations:
		this.tracker.listeningExpectations.rePopulate()

		return {
			promise: Promise.all(cancelPromises).then(() => {
				return // void
			}),
		}
	}
	/** Iterate through the tracked Expectations */
	private async _evaluateAllExpectations(): Promise<{ runAgainASAP: boolean; times: { [key: string]: number } }> {
		/** If this is set to true, we want _evaluateExpectations() to be run again ASAP */
		let runAgainASAP = false

		const times: { [key: string]: number } = {}

		const removeIds: ExpectationId[] = []

		const tracked = this.tracker.trackedExpectations.list()

		// Step 0: Reset the session:
		for (const trackedExp of tracked) {
			trackedExp.session = {}
		}

		const postProcessSession = (trackedExp: TrackedExpectation) => {
			if (trackedExp.session?.triggerOtherExpectationsAgain) {
				// Will cause another iteration of this._handleExpectations to be called again ASAP after this iteration has finished
				runAgainASAP = true
			}
			if (trackedExp.session?.expectationCanBeRemoved) {
				// The tracked expectation can be removed
				removeIds.push(trackedExp.id)
			}
		}

		/** These states can be handled in parallel */
		const handleStatesParallel = [
			// Note: The order of these is important, as the states normally progress in this order:
			ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
			ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
			ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
			ExpectedPackageStatusAPI.WorkStatusState.NEW,
			ExpectedPackageStatusAPI.WorkStatusState.WAITING,
			ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
		]

		/** These states must be handled one at a time */
		const handleStatesSerial = [
			ExpectedPackageStatusAPI.WorkStatusState.READY,
			ExpectedPackageStatusAPI.WorkStatusState.WORKING,
		]

		/** Count of expectations that are in READY or WORKING */
		const readyCount = tracked.reduce(
			(memo, trackedExp) =>
				trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.READY ||
				trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING
					? memo + 1
					: memo,
			0
		)

		// Step 1: Evaluate the Expectations which are in the states that can be handled in parallel:
		for (const handleState of handleStatesParallel) {
			const timer = startTimer()
			// Filter out the ones that are in the state we're about to handle:
			const trackedWithState = tracked.filter((trackedExp) => trackedExp.state === handleState)

			if (trackedWithState.length) {
				this.logger.debug(`Handle state ${handleState}, ${trackedWithState.length} expectations..`)
			}

			if (trackedWithState.length) {
				// We're using a PromisePool so that we don't send out an unlimited number of parallel requests to the workers.

				for (const trackedExp of trackedWithState) {
					trackedExp.skipEvaluationCount++
				}

				const startTime = Date.now()
				/** How long to wait before skipping ahead to process the next state */
				const allowSkipTime =
					this.tracker.constants.ALLOW_SKIPPING_QUEUE_TIME *
					// If there are expectations in READY, we should skip ahead to process them sooner:
					(readyCount > 0 ? 0.25 : 0.5)

				await PromisePool.for(trackedWithState)
					.withConcurrency(this.tracker.constants.PARALLEL_CONCURRENCY)
					.handleError(async (error, trackedExp) => {
						// Log the error
						this.logger.error(stringifyError(error))
						if (trackedExp.session) {
							// Mark the expectation so that it won't be evaluated again this round:
							trackedExp.session.hadError = true
						}
					})
					.process(async (trackedExp, _index, pool) => {
						// If enough time has passed since we started processing this state,
						// we should move on to the next state (by cancelling handling the rest of the expectations in this PromisePool).
						// This is so that we can continue to process other states that might be more important.

						const timeSinceStart = Date.now() - startTime
						if (timeSinceStart > allowSkipTime) {
							this.logger.debug(`Skipping ahead (after ${timeSinceStart}ms, limit: ${allowSkipTime}ms)`)
							pool.stop()
							return
						}

						await evaluateExpectationState(this, trackedExp)
						postProcessSession(trackedExp)
					})
			}
			times[`time_${handleState}`] = timer.get()
		}

		// Step 1.5: Reset the session:
		// Because during the next iteration, the worker-assignment need to be done in series
		for (const trackedExp of tracked) {
			trackedExp.session = {}
		}

		this.logger.debug(`Handle other states..`)
		handleStatesSerial.forEach((handleState) => {
			const trackedWithState = tracked.filter((trackedExp) => trackedExp.state === handleState)
			this.logger.debug(`Handle state ${handleState}, ${trackedWithState.length} expectations..`)
		})
		this.logger.debug(`Worker count: ${this.manager.workerAgents.list().length}`)

		const timer = startTimer()
		// Step 2: Evaluate the expectations, now one by one:
		for (const trackedExp of tracked) {
			// Only handle the states that are in this state
			if (handleStatesSerial.includes(trackedExp.state)) {
				// Evaluate the Expectation:
				await evaluateExpectationState(this, trackedExp)
				postProcessSession(trackedExp)
			}

			if (runAgainASAP && timer.get() > this.tracker.constants.ALLOW_SKIPPING_QUEUE_TIME) {
				// Skip the rest of the queue, so that we don't get stuck on evaluating low-prio expectations.
				this.logger.debug(
					`Skipping the rest of the queue (after ${this.tracker.constants.ALLOW_SKIPPING_QUEUE_TIME})`
				)
				break
			}
			if (this.tracker.receivedUpdates.expectationsHasBeenUpdated) {
				// We have received new expectations. We should abort the evaluation-loop and restart from the beginning.
				// So that we don't miss any high-prio Expectations.
				this.logger.debug(`Skipping the rest of the queue, due to expectations has been updated`)
				runAgainASAP = true
				break
			}
		}
		times[`time_restTrackedExp`] = timer.get()
		for (const id of removeIds) {
			this.tracker.trackedExpectations.remove(id)
		}

		return { runAgainASAP, times }
	}
	/** Goes through the incoming data and stores it */
	private async _updateReceivedData_TrackedPackageContainers() {
		this.tracker.receivedUpdates.packageContainersHasBeenUpdated = false

		// Added / Changed
		for (const packageContainer of this.tracker.receivedUpdates.getPackageContainers()) {
			let isNew = false
			let isUpdated = false

			let trackedPackageContainer: TrackedPackageContainerExpectation

			const existingPackageContainer = this.tracker.trackedPackageContainers.get(packageContainer.id)
			if (!existingPackageContainer) {
				// Is new

				isNew = true
				isUpdated = true

				trackedPackageContainer = {
					id: packageContainer.id,
					packageContainer: packageContainer,
					currentWorker: null,
					waitingForWorkerTime: null,
					isUpdated: true,
					removed: false,
					lastEvaluationTime: 0,
					lastCronjobTime: 0,
					monitorIsSetup: false,
					status: {
						status: StatusCode.UNKNOWN,
						statusReason: { user: '', tech: '' },
						statusChanged: 0,
						monitors: {},
					},
				}
				this.tracker.trackedPackageContainers.upsert(packageContainer.id, trackedPackageContainer)
			} else {
				trackedPackageContainer = existingPackageContainer

				if (!_.isEqual(existingPackageContainer.packageContainer, packageContainer)) {
					isUpdated = true
				} else if (this.tracker.receivedUpdates.isRestartPackageContainer(packageContainer.id)) {
					isUpdated = true
				}
			}

			if (isUpdated) {
				trackedPackageContainer.packageContainer = packageContainer
				trackedPackageContainer.isUpdated = true
				trackedPackageContainer.removed = false

				if (isNew) {
					this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
						trackedPackageContainer,
						StatusCode.UNKNOWN,
						{
							user: `Added just now`,
							tech: `Added ${Date.now()}`,
						}
					)
				} else {
					this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
						trackedPackageContainer,
						StatusCode.UNKNOWN,
						{
							user: `Updated just now`,
							tech: `Updated ${Date.now()}`,
						}
					)
				}
			}
		}

		// Removed:
		for (const trackedPackageContainer of this.tracker.trackedPackageContainers.list()) {
			const containerId = trackedPackageContainer.id
			if (!this.tracker.receivedUpdates.getPackageContainer(containerId)) {
				// This packageContainersExpectation has been removed

				if (trackedPackageContainer.currentWorker) {
					const workerAgent = this.manager.workerAgents.get(trackedPackageContainer.currentWorker)
					if (workerAgent && workerAgent.connected) {
						try {
							const result = await workerAgent.api.disposePackageContainerMonitors(containerId)
							if (result.success) {
								trackedPackageContainer.removed = true
								this.manager.callbacks.reportPackageContainerExpectationStatus(containerId, null)

								this.tracker.trackedPackageContainers.remove(containerId)
							} else {
								this.logger.error(
									`_updateReceivedData_TrackedPackageContainers: disposePackageContainerMonitors did not succeed: ${JSON.stringify(
										result.reason
									)}`
								)
								this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
									trackedPackageContainer,
									StatusCode.BAD,
									result.reason
								)
							}
						} catch (err) {
							this.logger.error(
								`_updateReceivedData_TrackedPackageContainers: Caught exception: ${JSON.stringify(err)}`
							)
							this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
								trackedPackageContainer,
								StatusCode.BAD,
								{
									user: 'Internal Error',
									tech: `Error when removing: ${stringifyError(err)}`,
								}
							)
						}
					}
				}
			}
		}

		this.tracker.receivedUpdates.clearRestartExpectations()
	}
	private async _evaluateAllTrackedPackageContainers(): Promise<void> {
		for (const trackedPackageContainer of this.tracker.trackedPackageContainers.list()) {
			const timer = startTimer()

			try {
				let badStatus = false
				trackedPackageContainer.lastEvaluationTime = Date.now()

				if (trackedPackageContainer.isUpdated) {
					// If the packageContainer was newly updated, reset and set up again:
					if (trackedPackageContainer.currentWorker) {
						const workerAgent = this.manager.workerAgents.get(trackedPackageContainer.currentWorker)
						if (workerAgent && workerAgent.connected) {
							const disposeMonitorResult = await workerAgent.api.disposePackageContainerMonitors(
								trackedPackageContainer.id
							)
							if (!disposeMonitorResult.success) {
								badStatus = true
								this.logger.debug(
									`_evaluateAllTrackedPackageContainers: disposePackageContainerMonitors did not succeed: ${JSON.stringify(
										disposeMonitorResult.reason
									)}`
								)
								this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
									trackedPackageContainer,
									StatusCode.BAD,
									{
										user: `Unable to restart monitor, due to ${disposeMonitorResult.reason.user}`,
										tech: `Unable to restart monitor: ${disposeMonitorResult.reason.tech}`,
									}
								)
								continue // Break further execution for this PackageContainer
							}
						} else {
							// Lost connection to the worker & monitor
						}
						trackedPackageContainer.currentWorker = null
					}
					trackedPackageContainer.isUpdated = false
				}

				if (trackedPackageContainer.currentWorker) {
					// Check that the worker still exists:
					if (!this.manager.workerAgents.get(trackedPackageContainer.currentWorker)) {
						trackedPackageContainer.currentWorker = null
					}
				}
				if (!trackedPackageContainer.currentWorker) {
					// Find a worker that supports this PackageContainer

					let notSupportReason: Reason | null = null
					await Promise.all(
						this.manager.workerAgents.list().map<Promise<void>>(async ({ workerId, workerAgent }) => {
							if (!workerAgent.connected) return

							const support = await workerAgent.api.doYouSupportPackageContainer(
								trackedPackageContainer.packageContainer
							)
							if (!trackedPackageContainer.currentWorker) {
								if (support.support) {
									trackedPackageContainer.currentWorker = workerId
								} else {
									notSupportReason = support.reason
								}
							}
						})
					)
					if (objectSize(trackedPackageContainer.packageContainer.accessors) > 0) {
						if (!trackedPackageContainer.currentWorker) {
							if (this.manager.workerAgents.list().length) {
								notSupportReason = {
									user: 'Found no worker that supports this packageContainer',
									tech: 'Found no worker that supports this packageContainer',
								}
							} else {
								notSupportReason = {
									user: 'No workers available',
									tech: 'No workers available',
								}
							}
						}
					} else {
						notSupportReason = {
							user: 'The PackageContainer has no accessors',
							tech: 'The PackageContainer has no accessors',
						}
					}

					if (notSupportReason) {
						badStatus = true
						this.logger.debug(
							`_evaluateAllTrackedPackageContainers: doYouSupportPackageContainer could not find a supportive worker for "${
								trackedPackageContainer.id
							}": ${JSON.stringify(notSupportReason)}`
						)
						this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
							trackedPackageContainer,
							StatusCode.BAD,
							{
								user: `Unable to handle PackageContainer, due to: ${notSupportReason.user}`,
								tech: `Unable to handle PackageContainer, due to: ${notSupportReason.tech}`,
							}
						)
						continue // Break further execution for this PackageContainer
					}
				}

				if (trackedPackageContainer.currentWorker) {
					const workerAgent = this.manager.workerAgents.get(trackedPackageContainer.currentWorker)

					if (!workerAgent) {
						this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
							trackedPackageContainer,
							StatusCode.BAD,
							{
								user: `Internal error`,
								tech: `Internal error: currentWorker (${trackedPackageContainer.currentWorker}) does not exist`,
							}
						)
						continue // Break further execution for this PackageContainer
					}

					if (objectSize(trackedPackageContainer.packageContainer.monitors) !== 0) {
						if (!trackedPackageContainer.monitorIsSetup) {
							const monitorSetup = await workerAgent.api.setupPackageContainerMonitors(
								trackedPackageContainer.packageContainer
							)

							trackedPackageContainer.status.monitors = {}
							if (monitorSetup.success) {
								trackedPackageContainer.monitorIsSetup = true
								for (const [monitorId, monitor] of objectEntries(monitorSetup.monitors)) {
									this.logger.debug(
										`Set up monitor "${monitor.label}" (${monitorId}) for PackageContainer ${trackedPackageContainer.id}`
									)

									if (trackedPackageContainer.status.monitors[monitorId]) {
										// In case there no monitor status has been emitted yet:
										this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerMonitorStatus(
											trackedPackageContainer,
											monitorId,
											monitor.label,
											StatusCode.UNKNOWN,
											{
												user: 'Setting up monitor...',
												tech: 'Setting up monitor...',
											}
										)
									}
								}
							} else {
								badStatus = true
								this.logger.debug(
									`_evaluateAllTrackedPackageContainers: setupPackageContainerMonitors did not succeed: ${JSON.stringify(
										monitorSetup.reason
									)}`
								)
								this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
									trackedPackageContainer,
									StatusCode.BAD,
									{
										user: `Unable to set up monitors for PackageContainer, due to: ${monitorSetup.reason.user}`,
										tech: `Unable to set up monitors for PackageContainer, due to: ${monitorSetup.reason.tech}`,
									}
								)
							}
						}
					}

					const cronjobInterval =
						trackedPackageContainer.packageContainer.cronjobs.interval ||
						this.tracker.constants.DEFAULT_CRONJOB_INTERVAL
					const timeSinceLastCronjob = Date.now() - trackedPackageContainer.lastCronjobTime
					if (timeSinceLastCronjob > cronjobInterval) {
						trackedPackageContainer.lastCronjobTime = Date.now()
						const cronJobStatus = await workerAgent.api.runPackageContainerCronJob(
							trackedPackageContainer.packageContainer
						)
						if (!cronJobStatus.success) {
							badStatus = true
							this.logger.error(
								`_evaluateAllTrackedPackageContainers: runPackageContainerCronJob did not succeed: ${JSON.stringify(
									cronJobStatus.reason
								)}`
							)
							this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
								trackedPackageContainer,
								StatusCode.BAD,
								{
									user: 'Cron job not completed, due to: ' + cronJobStatus.reason.user,
									tech: 'Cron job not completed, due to: ' + cronJobStatus.reason.tech,
								}
							)
							continue
						}
					}
				}

				if (!badStatus) {
					this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
						trackedPackageContainer,
						StatusCode.GOOD,
						{
							user: `All good`,
							tech: `All good`,
						}
					)
				}
			} catch (err) {
				this.logger.error(`_evaluateAllTrackedPackageContainers: ${JSON.stringify(err)}`)
				this.tracker.trackedPackageContainerAPI.updateTrackedPackageContainerStatus(
					trackedPackageContainer,
					StatusCode.BAD,
					{
						user: 'Internal Error',
						tech: `Unhandled Error: ${stringifyError(err)}`,
					}
				)
			}
			this.logger.silly(`trackedPackageContainer ${trackedPackageContainer.id}, took ${timer.get()} ms`)
		}
	}
}
export interface EvaluationResult {
	runAgainASAP: boolean
}
