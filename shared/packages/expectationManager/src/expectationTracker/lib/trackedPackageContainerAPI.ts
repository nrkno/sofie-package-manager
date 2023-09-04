// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { deepEqual, MonitorId, Reason, StatusCode, unprotectString } from '@sofie-package-manager/api'
import { TrackedPackageContainerExpectation } from '../../lib/trackedPackageContainerExpectation'
import { ExpectationTracker } from '../expectationTracker'

/** Various methods related to TrackedPackageContainer */
export class TrackedPackageContainerAPI {
	constructor(private tracker: ExpectationTracker) {}

	/**
	 * Update the status of a PackageContainer.
	 * This is called by EvaluationRunner.
	 */
	public updateTrackedPackageContainerStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		status: StatusCode,
		statusReason: Reason
	): void {
		if (trackedPackageContainer.removed) return

		let updatedStatus = false
		trackedPackageContainer.status.statusChanged = Date.now()

		if (trackedPackageContainer.status.status !== status) {
			trackedPackageContainer.status.status = status
			updatedStatus = true
		}
		if (trackedPackageContainer.status.statusReason !== statusReason) {
			trackedPackageContainer.status.statusReason = statusReason
			updatedStatus = true
		}

		if (updatedStatus) {
			this.tracker.callbacks.reportPackageContainerExpectationStatus(
				trackedPackageContainer.id,
				trackedPackageContainer.status
			)
		}
	}
	/** Update the status of a PackageContainer monitor */
	public updateTrackedPackageContainerMonitorStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		monitorId: MonitorId,
		monitorLabel: string | undefined,
		status: StatusCode,
		statusReason: Reason
	): void {
		if (trackedPackageContainer.removed) return

		let updatedStatus = false
		trackedPackageContainer.status.statusChanged = Date.now()
		const monitorIdStr = unprotectString(monitorId)

		const existingMonitorStatus = trackedPackageContainer.status.monitors[monitorIdStr]
		const newMonitorStatus: ExpectedPackageStatusAPI.PackageContainerMonitorStatus = {
			label: monitorLabel || existingMonitorStatus?.label || monitorIdStr,
			status: status,
			statusReason: statusReason,
		}

		if (!existingMonitorStatus || !deepEqual(existingMonitorStatus, newMonitorStatus)) {
			trackedPackageContainer.status.monitors[monitorIdStr] = newMonitorStatus
			updatedStatus = true
		}

		if (updatedStatus) {
			this.tracker.callbacks.reportPackageContainerExpectationStatus(
				trackedPackageContainer.id,
				trackedPackageContainer.status
			)
		}
	}
}
