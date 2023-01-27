// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { deepEqual, Reason, StatusCode } from '@sofie-package-manager/api'
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
		monitorId: string,
		monitorLabel: string | undefined,
		status: StatusCode,
		statusReason: Reason
	): void {
		if (trackedPackageContainer.removed) return

		let updatedStatus = false
		trackedPackageContainer.status.statusChanged = Date.now()

		const existingMonitorStatus = trackedPackageContainer.status.monitors[monitorId]
		const newMonitorStatus: ExpectedPackageStatusAPI.PackageContainerMonitorStatus = {
			label: monitorLabel || existingMonitorStatus?.label || monitorId,
			status: status,
			statusReason: statusReason,
		}

		if (!existingMonitorStatus || !deepEqual(existingMonitorStatus, newMonitorStatus)) {
			trackedPackageContainer.status.monitors[monitorId] = newMonitorStatus
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
