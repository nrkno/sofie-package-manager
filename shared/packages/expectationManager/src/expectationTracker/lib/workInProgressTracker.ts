// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { ExpectationManagerWorkerAgent, LoggerInstance, Reason, stringifyError } from '@sofie-package-manager/api'
import { expLabel, TrackedExpectation } from '../../lib/trackedExpectation'
import { ExpectationTracker } from '../expectationTracker'
import { WorkerAgentAPI } from '../../workerAgentApi'

/**
 * This class tracks works-in-progress.
 * It receives update-events from a Worker
 */
export class WorkInProgressTracker {
	private worksInProgress: { [id: string]: WorkInProgress } = {}

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('WIPTracker')
	}
	public getWorksInProgress(): { [id: string]: WorkInProgress } {
		return this.worksInProgress
	}
	public upsert(workerId: string, wipId: number, wip: WorkInProgress): void {
		this.worksInProgress[this.getId(workerId, wipId)] = wip
	}
	private get(id: string): WorkInProgress | undefined {
		return this.worksInProgress[id]
	}
	private remove(id: string): void {
		delete this.worksInProgress[id]
	}
	/** Monitor the Works in progress, to restart them if necessary. */
	public checkWorksInProgress(): void {
		for (const [wipId, wip] of Object.entries(this.worksInProgress)) {
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				if (Date.now() - wip.lastUpdated > this.tracker.constants.WORK_TIMEOUT_TIME) {
					// It seems that the work has stalled..

					this.logger.warn(`Work "${wipId}" on exp "${expLabel(wip.trackedExp)}" has stalled, restarting it`)

					// Restart the job:
					const reason: Reason = {
						tech: 'WorkInProgress timeout',
						user: 'The job timed out',
					}

					wip.trackedExp.errorCount++
					this.tracker.updateTrackedExpectationStatus(wip.trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason,
					})
					this.remove(wipId)

					// Send a cancel request to the worker as a courtesy:
					wip.worker.cancelWorkInProgress(wip.wipId).catch((err) => {
						this.logger.error(`Error when cancelling timed out work "${wipId}" ${stringifyError(err)}`)
					})
				}
			} else {
				// huh, it seems that we have a workInProgress, but the trackedExpectation is not WORKING
				this.logger.error(
					`WorkInProgress ${wipId} has an exp (${expLabel(wip.trackedExp)}) which is not working..`
				)
				this.remove(wipId)
			}
		}
	}
	/** Called when there is a progress-message from a worker */
	public async onWipEventProgress(
		clientId: string,
		wipId: number,
		actualVersionHash: string | null,
		progress: number
	): Promise<void> {
		const wip = this.worksInProgress[`${clientId}_${wipId}`]
		if (wip) {
			wip.lastUpdated = Date.now()
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				this.tracker.updateTrackedExpectationStatus(wip.trackedExp, {
					status: {
						actualVersionHash: actualVersionHash,
						workProgress: progress,
					},
				})
				this.logger.debug(`Expectation "${expLabel(wip.trackedExp)}" progress: ${progress}`)
			} else {
				// Expectation not in WORKING state, ignore
			}
		} else {
			// not found, ignore
		}
	}
	/** Called when there is a done-message from a worker */
	public async onWipEventDone(
		workerId: string,
		wipId: number,
		actualVersionHash: string,
		reason: Reason,
		_result: unknown
	): Promise<void> {
		const id = this.getId(workerId, wipId)
		const wip = this.get(id)
		if (wip) {
			wip.lastUpdated = Date.now()
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				wip.trackedExp.status.actualVersionHash = actualVersionHash
				wip.trackedExp.status.workProgress = 1
				this.tracker.updateTrackedExpectationStatus(wip.trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
					reason,
					status: {
						workProgress: 1,
					},
				})

				if (this.tracker.onExpectationFullfilled(wip.trackedExp)) {
					// Something was triggered, run again asap.
					// We should reevaluate asap, so that any other expectation which might be waiting on this work could start.
					this.tracker.triggerEvaluateExpectationsNow()
				}
			} else {
				// Expectation not in WORKING state, ignore
			}
			this.remove(id)
		} else {
			// not found, ignore
		}
	}
	/** Called when there is a error-message from a worker */
	public async onWipEventError(clientId: string, wipId: number, reason: Reason): Promise<void> {
		const wip = this.worksInProgress[this.getId(clientId, wipId)]
		if (wip) {
			wip.lastUpdated = Date.now()
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				wip.trackedExp.errorCount++
				this.tracker.updateTrackedExpectationStatus(wip.trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					reason,
					isError: true,
				})
			} else {
				// Expectation not in WORKING state, ignore
			}
			delete this.worksInProgress[`${clientId}_${wipId}`]
		} else {
			// not found, ignore
		}
	}
	private getId(workerId: string, wipId: number): string {
		return `${workerId}_${wipId}`
	}
}
export interface WorkInProgress {
	wipId: number
	properties: ExpectationManagerWorkerAgent.WorkInProgressProperties
	trackedExp: TrackedExpectation
	workerId: string
	worker: WorkerAgentAPI
	cost: number
	startCost: number
	lastUpdated: number
}
