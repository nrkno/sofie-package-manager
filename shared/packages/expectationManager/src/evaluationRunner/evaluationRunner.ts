// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import {
	diff,
	literal,
	LoggerInstance,
	PackageContainerExpectation,
	Reason,
	StatusCode,
	stringifyError,
} from '@sofie-package-manager/api'
import PromisePool from '@supercharge/promise-pool'
import _ from 'underscore'
import { evaluateExpectationState } from './evaluateExpectationState'
import { InternalManager } from '../internalManager/internalManager'
import { ExpectationTracker } from '../expectationTracker/expectationTracker'
import { expLabel, getDefaultTrackedExpectation, TrackedExpectation } from '../lib/trackedExpectation'
import { TrackedPackageContainerExpectation } from '../lib/trackedPackageContainerExpectation'

/**
 * The EvaluationRunner goes through one pass of evaluation of expectations.
 * When an evaulation is scheduled to run,
 * a new instance of EvaluationRunner is created, then the async .run() method is called.
 * After .run() is done, the instance is not used again.
 */
export class EvaluationRunner {
	static instanceId = 0

	public logger: LoggerInstance
	private instanceId: number
	/** When true, try to abort the .run()-method when possible */
	private abortRun = false

	constructor(logger: LoggerInstance, public manager: InternalManager, public tracker: ExpectationTracker) {
		this.instanceId = EvaluationRunner.instanceId++
		this.logger = logger.category(`Runner_${this.instanceId}`)
	}
	public async run(): Promise<EvaluationResult> {
		this.logger.verbose(Date.now() / 1000 + ' _evaluateExpectations ----------')

		let runAgainASAP = false
		let startTime = Date.now()
		const times: { [key: string]: number } = {}

		if (!this.abortRun) {
			startTime = Date.now()
			// First we're going to see if there is any new incoming data which needs to be pulled in:
			if (this.tracker.receivedUpdates.expectationsHasBeenUpdated) {
				await this.updateReceivedData_Expectations().promise
			}
			times['timeUpdateReceivedExpectations'] = Date.now() - startTime
		}

		if (!this.abortRun) {
			startTime = Date.now()
			if (this.tracker.receivedUpdates.packageContainersHasBeenUpdated) {
				await this._updateReceivedData_TrackedPackageContainers()
			}
			times['timeUpdateReceivedPackageContainerExpectations'] = Date.now() - startTime
		}

		if (!this.abortRun) {
			startTime = Date.now()
			// Iterate through the PackageContainerExpectations:
			await this._evaluateAllTrackedPackageContainers()
			times['timeEvaluateAllTrackedPackageContainers'] = Date.now() - startTime
		}

		if (!this.abortRun) {
			startTime = Date.now()
			this.tracker.worksInProgress.checkWorksInProgress()
			times['timeMonitorWorksInProgress'] = Date.now() - startTime
		}

		if (!this.abortRun) {
			// Iterate through all Expectations:
			startTime = Date.now()
			const evExpResult = await this._evaluateAllExpectations()
			runAgainASAP = evExpResult.runAgainASAP
			for (const [key, value] of Object.entries(evExpResult.times)) {
				times[key] = value
			}
			times['timeEvaluateAllExpectations'] = Date.now() - startTime
		}

		if (!this.abortRun) {
			startTime = Date.now()
			await this.tracker.scaler.checkIfNeedToScaleUp().catch((err) => {
				this.logger.error(`Error in checkIfNeedToScaleUp: ${stringifyError(err)}`)
			})
			times['timeCheckIfNeedToScaleUp'] = Date.now() - startTime
		}

		if (this.abortRun) times['aborted'] = Date.now() - startTime
		this.manager.statusReport.update(times)

		return literal<EvaluationResult>({
			runAgainASAP,
		})
	}
	/** Called to kindly ask the .run()-method to abort when possible */
	public pleaseAbortRun(): void {
		this.abortRun = true
	}
	/** Goes through the incoming data and stores it */
	private updateReceivedData_Expectations(): {
		promise: Promise<void>
	} {
		this.tracker.receivedUpdates.expectationsHasBeenUpdated = false

		const cancelPromises: Promise<void>[] = []

		// Added / Changed Expectations
		for (const id of Object.keys(this.tracker.receivedUpdates.expectations)) {
			const exp = this.tracker.receivedUpdates.expectations[id]

			let diffExplanation: string | null = null

			let difference: null | 'new' | 'major' | 'minor' = null
			const existingtrackedExp = this.tracker.trackedExpectations.get(id)
			if (!existingtrackedExp) {
				// new
				difference = 'new'
			} else {
				// Treat differences in priority as a "minor" update:
				diffExplanation = diff(existingtrackedExp.exp, exp, ['priority'])
				const isSignificantlyDifferent = Boolean(diffExplanation)
				const isPriorityDifferent = existingtrackedExp.exp.priority !== exp.priority

				if (isSignificantlyDifferent) {
					const trackedExp = existingtrackedExp

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
				const newTrackedExp = getDefaultTrackedExpectation(exp, existingtrackedExp)

				this.tracker.trackedExpectations.upsert(id, newTrackedExp)
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

				const trackedExp = this.tracker.trackedExpectations.get(id)
				if (trackedExp) {
					this.logger.debug(
						`Minor update of expectation "${expLabel(trackedExp)}": ${diff(existingtrackedExp?.exp, exp)}`
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

			if (!this.tracker.receivedUpdates.expectations[id]) {
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
				this.tracker.receivedUpdates.restartExpectations[id] = true
			}
		}
		this.tracker.receivedUpdates.restartAllExpectations = false

		for (const id of Object.keys(this.tracker.receivedUpdates.restartExpectations)) {
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
		this.tracker.receivedUpdates.restartExpectations = {}

		// Aborted:
		for (const id of Object.keys(this.tracker.receivedUpdates.abortExpectations)) {
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
		this.tracker.receivedUpdates.abortExpectations = {}

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

		const removeIds: string[] = []

		const tracked = this.tracker.trackedExpectations.list()

		// Step 0: Reset the session:
		for (const trackedExp of tracked) {
			trackedExp.session = null
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

		// Step 1: Evaluate the Expectations which are in the states that can be handled in parallel:
		for (const handleState of handleStatesParallel) {
			const startTime = Date.now()
			// Filter out the ones that are in the state we're about to handle:
			const trackedWithState = tracked.filter((trackedExp) => trackedExp.state === handleState)

			if (trackedWithState.length) {
				this.logger.verbose(`Handle state ${handleState}, ${trackedWithState.length} expectations..`)
			}

			if (trackedWithState.length) {
				// We're using a PromisePool so that we don't send out an unlimited number of parallel requests to the workers.

				await PromisePool.for(trackedWithState)
					.withConcurrency(this.tracker.constants.PARALLEL_CONCURRENCY)
					.handleError(async (error, trackedExp) => {
						// Log the error
						this.logger.error(error.name + error.message)
						if (trackedExp.session) {
							// Mark the expectation so that it won't be evaluated again this round:
							trackedExp.session.hadError = true
						}
					})
					.process(async (trackedExp) => {
						if (this.abortRun) return // abort the run

						await evaluateExpectationState(this, trackedExp)
						postProcessSession(trackedExp)
					})
			}
			times[`time_${handleState}`] = Date.now() - startTime
		}

		// Step 1.5: Reset the session:
		// Because during the next iteration, the worker-assignment need to be done in series
		for (const trackedExp of tracked) {
			trackedExp.session = null
		}

		this.logger.verbose(`Handle other states..`)
		handleStatesSerial.forEach((handleState) => {
			const trackedWithState = tracked.filter((trackedExp) => trackedExp.state === handleState)
			this.logger.verbose(`Handle state ${handleState}, ${trackedWithState.length} expectations..`)
		})
		this.logger.verbose(`Worker count: ${this.manager.workerAgents.list().length}`)

		const startTime = Date.now()
		// Step 2: Evaluate the expectations, now one by one:
		for (const trackedExp of tracked) {
			if (this.abortRun) break // Abort the run

			// Only handle the states that
			if (handleStatesSerial.includes(trackedExp.state)) {
				// Evaluate the Expectation:
				await evaluateExpectationState(this, trackedExp)
				postProcessSession(trackedExp)
			}

			if (runAgainASAP && Date.now() - startTime > this.tracker.constants.ALLOW_SKIPPING_QUEUE_TIME) {
				// Skip the rest of the queue, so that we don't get stuck on evaluating low-prio expectations.
				this.logger.verbose(
					`Skipping the rest of the queue (after ${this.tracker.constants.ALLOW_SKIPPING_QUEUE_TIME})`
				)
				break
			}
			if (this.tracker.receivedUpdates.expectationsHasBeenUpdated) {
				// We have received new expectations. We should abort the evaluation-loop and restart from the beginning.
				// So that we don't miss any high-prio Expectations.
				this.logger.verbose(`Skipping the rest of the queue, due to expectations has been updated`)
				runAgainASAP = true
				break
			}
		}
		times[`time_restTrackedExp`] = Date.now() - startTime
		for (const id of removeIds) {
			this.tracker.trackedExpectations.remove(id)
		}

		return { runAgainASAP, times }
	}
	/** Goes through the incoming data and stores it */
	private async _updateReceivedData_TrackedPackageContainers() {
		this.tracker.receivedUpdates.packageContainersHasBeenUpdated = false

		// Added / Changed
		for (const containerId of Object.keys(this.tracker.receivedUpdates.packageContainers)) {
			const packageContainer: PackageContainerExpectation =
				this.tracker.receivedUpdates.packageContainers[containerId]

			let isNew = false
			let isUpdated = false

			let trackedPackageContainer: TrackedPackageContainerExpectation

			const existingPackageContainer = this.tracker.trackedPackageContainers.get(containerId)
			if (!existingPackageContainer) {
				// Is new

				isNew = true
				isUpdated = true

				trackedPackageContainer = {
					id: containerId,
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
				this.tracker.trackedPackageContainers.upsert(containerId, trackedPackageContainer)
			} else {
				trackedPackageContainer = existingPackageContainer

				if (!_.isEqual(existingPackageContainer.packageContainer, packageContainer)) {
					isUpdated = true
				} else if (this.tracker.receivedUpdates.restartPackageContainers[containerId]) {
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
			if (!this.tracker.receivedUpdates.packageContainers[containerId]) {
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

		this.tracker.receivedUpdates.restartPackageContainers = {}
	}
	private async _evaluateAllTrackedPackageContainers(): Promise<void> {
		for (const trackedPackageContainer of this.tracker.trackedPackageContainers.list()) {
			if (this.abortRun) break // abort the run

			const startTime = Date.now()

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
								this.logger.verbose(
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
							// Lost connecttion to the worker & monitor
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
					if (Object.keys(trackedPackageContainer.packageContainer.accessors).length > 0) {
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
						this.logger.verbose(
							`_evaluateAllTrackedPackageContainers: doYouSupportPackageContainer could not find a supportive worker: ${JSON.stringify(
								notSupportReason
							)}`
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

					if (Object.keys(trackedPackageContainer.packageContainer.monitors).length !== 0) {
						if (!trackedPackageContainer.monitorIsSetup) {
							const monitorSetup = await workerAgent.api.setupPackageContainerMonitors(
								trackedPackageContainer.packageContainer
							)

							trackedPackageContainer.status.monitors = {}
							if (monitorSetup.success) {
								trackedPackageContainer.monitorIsSetup = true
								for (const [monitorId, monitor] of Object.entries(monitorSetup.monitors)) {
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
								this.logger.verbose(
									`_evaluateAllTrackedPackageContainers: setupPackageContainerMonitors did not suceed: ${JSON.stringify(
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
								`_evaluateAllTrackedPackageContainers: runPackageContainerCronJob did not suceed: ${JSON.stringify(
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
			this.logger.debug(
				`trackedPackageContainer ${trackedPackageContainer.id}, took ${Date.now() - startTime} ms`
			)
		}
	}
}
export interface EvaluationResult {
	runAgainASAP: boolean
}
