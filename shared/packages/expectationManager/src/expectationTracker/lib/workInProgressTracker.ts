// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import {
	ExpectationManagerWorkerAgent,
	LoggerInstance,
	Reason,
	WorkInProgressId,
	WorkInProgressLocalId,
	WorkerAgentId,
	protectString,
	stringifyError,
} from '@sofie-package-manager/api'
import { expLabel, TrackedExpectation } from '../../lib/trackedExpectation'
import { ExpectationTracker } from '../expectationTracker'
import { WorkerAgentAPI } from '../../workerAgentApi'

/**
 * This class tracks works-in-progress.
 * It receives update-events from a Worker
 */
export class WorkInProgressTracker {
	private worksInProgress: Map<WorkInProgressId, WorkInProgress> = new Map()

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('WIPTracker')
	}
	public getWorksInProgress(): Map<WorkInProgressId, WorkInProgress> {
		return this.worksInProgress
	}
	public upsert(workerId: WorkerAgentId, wipId: WorkInProgressLocalId, wip: WorkInProgress): void {
		this.worksInProgress.set(this.getId(workerId, wipId), wip)
	}
	private get(id: WorkInProgressId): WorkInProgress | undefined {
		return this.worksInProgress.get(id)
	}
	private remove(id: WorkInProgressId): void {
		this.worksInProgress.delete(id)
	}
	/** Monitor the Works in progress, to restart them if necessary. */
	public checkWorksInProgress(): void {
		for (const [wipId, wip] of this.worksInProgress.entries()) {
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
					this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(wip.trackedExp, {
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
		clientId: WorkerAgentId,
		wipId: WorkInProgressLocalId,
		actualVersionHash: string | null,
		progress: number
	): Promise<void> {
		const wip = this.worksInProgress.get(this.getId(clientId, wipId))
		if (wip) {
			wip.lastUpdated = Date.now()
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(wip.trackedExp, {
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
		workerId: WorkerAgentId,
		wipId: WorkInProgressLocalId,
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
				this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(wip.trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
					reason,
					status: {
						workProgress: 1,
					},
				})

				if (this.tracker.trackedExpectationAPI.onExpectationFulfilled(wip.trackedExp)) {
					// Something was triggered, run again asap.
					// We should reevaluate asap, so that any other expectation which might be waiting on this work could start.
					this.tracker.triggerEvaluationNow()
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
	public async onWipEventError(clientId: WorkerAgentId, wipId: WorkInProgressLocalId, reason: Reason): Promise<void> {
		const wip = this.worksInProgress.get(this.getId(clientId, wipId))
		if (wip) {
			wip.lastUpdated = Date.now()
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				wip.trackedExp.errorCount++
				this.tracker.trackedExpectationAPI.updateTrackedExpectationStatus(wip.trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					reason,
					isError: true,
				})
			} else {
				// Expectation not in WORKING state, ignore
			}
			this.worksInProgress.delete(this.getId(clientId, wipId))
		} else {
			// not found, ignore
		}
	}
	private getId(workerId: WorkerAgentId, wipId: WorkInProgressLocalId): WorkInProgressId {
		return protectString<WorkInProgressId>(`${workerId}_${wipId}`)
	}
}
export interface WorkInProgress {
	wipId: WorkInProgressLocalId
	properties: ExpectationManagerWorkerAgent.WorkInProgressProperties
	trackedExp: TrackedExpectation
	workerId: WorkerAgentId
	worker: WorkerAgentAPI
	cost: number
	startCost: number
	lastUpdated: number
}
