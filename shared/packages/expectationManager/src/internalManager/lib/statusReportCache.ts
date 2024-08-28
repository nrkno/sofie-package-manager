// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { assertNever, ExpectationManagerStatusReport } from '@sofie-package-manager/api'
import { InternalManager } from '../internalManager'

/**  */
export class StatusReportCache {
	public statusReport: ExpectationManagerStatusReport

	constructor(private manager: InternalManager) {
		this.statusReport = this.getManagerStatusReport({})
	}

	public get(): ExpectationManagerStatusReport {
		return this.statusReport
	}
	/**
	 * Called at the end of an evaluation.
	 * Updates the .statusReport property
	 */
	public update(times: { [key: string]: number }): void {
		this.statusReport = this.getManagerStatusReport(times)
	}
	private getManagerStatusReport(times: { [key: string]: number }): ExpectationManagerStatusReport {
		const statusReport = {
			id: this.manager.managerId,
			updated: Date.now(),
			expectationStatistics: {
				countTotal: 0,

				countNew: 0,
				countWaiting: 0,
				countReady: 0,
				countWorking: 0,
				countFulfilled: 0,
				countRemoved: 0,
				countRestarted: 0,
				countAborted: 0,

				countNoAvailableWorkers: 0,
				countError: 0,
			},
			times: times,
			workerAgents: this.manager.workerAgents.list().map(({ workerId }) => {
				return {
					workerId: workerId,
				}
			}),
			worksInProgress: Array.from(this.manager.tracker.worksInProgress.getWorksInProgress()).map(([id, wip]) => {
				return {
					id: id,
					lastUpdated: wip.lastUpdated,
					workerId: wip.workerId,
					cost: wip.cost,
					label: wip.trackedExp.exp.statusReport.label,
					progress: Math.floor((wip.trackedExp.status.workProgress || 0) * 1000) / 1000,
					expectationId: wip.trackedExp.id,
				}
			}),
		}
		const expectationStatistics = statusReport.expectationStatistics
		for (const exp of this.manager.tracker.getSortedTrackedExpectations()) {
			expectationStatistics.countTotal++

			if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW) {
				expectationStatistics.countNew++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
				expectationStatistics.countWaiting++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.READY) {
				expectationStatistics.countReady++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				expectationStatistics.countWorking++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
				expectationStatistics.countFulfilled++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.REMOVED) {
				expectationStatistics.countRemoved++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.RESTARTED) {
				expectationStatistics.countRestarted++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.ABORTED) {
				expectationStatistics.countAborted++
			} else assertNever(exp.state)

			if (exp.availableWorkers.size === 0) {
				expectationStatistics.countNoAvailableWorkers++
			}
			if (
				exp.errorCount > 0 &&
				exp.state !== ExpectedPackageStatusAPI.WorkStatusState.WORKING &&
				exp.state !== ExpectedPackageStatusAPI.WorkStatusState.FULFILLED
			) {
				expectationStatistics.countError++
			}
		}
		return statusReport
	}
}
