import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'

/** Note: This is based on the Core method updateExpectedPackageWorkStatuses. */
export type UpdateExpectedPackageWorkStatusesChanges = (
	| {
			id: string
			type: 'delete'
	  }
	| {
			id: string
			type: 'insert'
			status: ExpectedPackageStatusAPI.WorkStatus
	  }
	| {
			id: string
			type: 'update'
			status: Partial<ExpectedPackageStatusAPI.WorkStatus>
	  }
)[]
/** Note: This is based on the Core method updatePackageContainerPackageStatuses. */
export type UpdatePackageContainerPackageStatusesChanges = (
	| {
			containerId: string
			packageId: string
			type: 'delete'
	  }
	| {
			containerId: string
			packageId: string
			type: 'update'
			status: ExpectedPackageStatusAPI.PackageContainerPackageStatus
	  }
)[]
/** Note: This is based on the Core method updatePackageContainerPackageStatuses. */
export type UpdatePackageContainerStatusesChanges = (
	| {
			containerId: string
			type: 'delete'
	  }
	| {
			containerId: string
			type: 'update'
			status: ExpectedPackageStatusAPI.PackageContainerStatus
	  }
)[]
