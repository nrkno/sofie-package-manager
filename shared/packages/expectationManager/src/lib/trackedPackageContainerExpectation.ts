// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { PackageContainerExpectation } from '@sofie-package-manager/api'
import _ from 'underscore'

export interface TrackedPackageContainerExpectation {
	/** Unique ID of the tracked packageContainer */
	id: string
	/** The PackageContainerExpectation */
	packageContainer: PackageContainerExpectation
	/** True whether the packageContainer was newly updated */
	isUpdated: boolean

	/** The currently assigned Worker */
	currentWorker: string | null
	/** Timestamp to track how long the packageContainer has been waiting for a worker (can't start working), used to request more resources */
	waitingForWorkerTime: number | null

	/** Timestamp of the last time the expectation was evaluated. */
	lastEvaluationTime: number

	/** Timestamp of the last time the cronjob was run */
	lastCronjobTime: number

	/** If the monitor is set up okay */
	monitorIsSetup: boolean

	/** These statuses are sent from the workers */
	status: ExpectedPackageStatusAPI.PackageContainerStatus

	/** Is set if the packageContainer has been removed */
	removed: boolean
}
