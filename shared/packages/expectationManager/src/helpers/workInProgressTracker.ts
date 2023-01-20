// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { ExpectationManagerWorkerAgent, LoggerInstance, Reason, stringifyError } from '@sofie-package-manager/api'
import { ExpectationTracker, expLabel, TrackedExpectation } from '../expectationTracker'
import { WorkerAgentAPI } from '../workerAgentApi'

export class WorkInProgressTracker {
	private worksInProgress: { [id: string]: WorkInProgress } = {}

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('WIPTracker')
	}
	public getWorksInProgress(): { [id: string]: WorkInProgress } {
		return this.worksInProgress
	}
	public get(id: string): WorkInProgress | undefined {
		return this.worksInProgress[id]
	}
	public upsert(workerId: string, wipId: number, wip: WorkInProgress): void {
		this.worksInProgress[`${workerId}_${wipId}`] = wip
	}
	/** Monitor the Works in progress, to restart them if necessary. */
	public monitorWorksInProgress(): void {
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
					this.tracker.updateTrackedExpStatus(wip.trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason,
					})
					delete this.worksInProgress[wipId]

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
				delete this.worksInProgress[wipId]
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
				this.tracker.updateTrackedExpStatus(wip.trackedExp, {
					status: {
						actualVersionHash: actualVersionHash,
						workProgress: progress,
					},
				})
				this.logger.debug(`Expectation "${expLabel(wip.trackedExp)}" progress: ${progress}`)
			} else {
				// ignore
			}
		}
	}
	/** Called when there is a done-message from a worker */
	public async onWipEventDone(
		clientId: string,
		wipId: number,
		actualVersionHash: string,
		reason: Reason,
		_result: unknown
	): Promise<void> {
		const wip = this.worksInProgress[`${clientId}_${wipId}`]
		if (wip) {
			wip.lastUpdated = Date.now()
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				wip.trackedExp.status.actualVersionHash = actualVersionHash
				wip.trackedExp.status.workProgress = 1
				this.tracker.updateTrackedExpStatus(wip.trackedExp, {
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
				// ignore
			}
			delete this.worksInProgress[`${clientId}_${wipId}`]
		}
	}
	/** Called when there is a error-message from a worker */
	public async onWipEventError(clientId: string, wipId: number, reason: Reason): Promise<void> {
		const wip = this.worksInProgress[`${clientId}_${wipId}`]
		if (wip) {
			wip.lastUpdated = Date.now()
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				wip.trackedExp.errorCount++
				this.tracker.updateTrackedExpStatus(wip.trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					reason,
					isError: true,
				})
			} else {
				// ignore
			}
			delete this.worksInProgress[`${clientId}_${wipId}`]
		}
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
