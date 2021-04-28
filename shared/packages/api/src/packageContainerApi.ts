import { PackageContainer } from '@sofie-automation/blueprints-integration'

export interface PackageContainerExpectation extends PackageContainer {
	/** ID of the PackageContainer */
	id: string
	/** ID of the manager that created the expectation */
	managerId: string
	/** Defines which cronjobs are expected to run */
	cronjobs: {
		/** How often the cronjob should run (approximately) */
		interval?: number
		cleanup?: {}
	}
	/** Defines which monitors are expected to run */
	monitors: {
		/** Monitor the packages of a PackageContainer */
		packages?: {
			// Todo: add options, such as filters, etc...
		}
	}
}
