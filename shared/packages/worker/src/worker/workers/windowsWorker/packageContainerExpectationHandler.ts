import {
	PackageContainerExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeRunPackageContainerCronJob,
	ReturnTypeSetupPackageContainerMonitors,
	ReturnTypeDisposePackageContainerMonitors,
} from '@shared/api'
import { Accessor, PackageContainer, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle } from '../../accessorHandlers/genericHandle'
import { GenericWorker } from '../../worker'
import { lookupAccessorHandles } from './expectationHandlers/lib'
import { findBestAccessorOnPackageContainer } from './lib/lib'

export async function doYouSupportPackageContainer(
	packageContainer: PackageContainerExpectation,
	genericWorker: GenericWorker
): Promise<ReturnTypeDoYouSupportPackageContainer> {
	return checkWorkerHasAccessToPackageContainer(genericWorker, packageContainer.id, packageContainer)
}
export async function runPackageContainerCronJob(
	packageContainer: PackageContainerExpectation,
	genericWorker: GenericWorker
): Promise<ReturnTypeRunPackageContainerCronJob> {
	// Quick-check: If there are no cronjobs at all, no need to check:
	if (!Object.keys(packageContainer.cronjobs).length) {
		return { completed: true } // all good
	}

	const lookup = await lookupPackageContainer(genericWorker, packageContainer, 'cronjob')
	if (!lookup.ready) return { completed: lookup.ready, reason: lookup.reason }

	const result = await lookup.handle.runCronJob(packageContainer)

	if (result) return { completed: false, reason: result }
	else return { completed: true } // all good
}
export async function setupPackageContainerMonitors(
	packageContainer: PackageContainerExpectation,
	genericWorker: GenericWorker
): Promise<ReturnTypeSetupPackageContainerMonitors> {
	const lookup = await lookupPackageContainer(genericWorker, packageContainer, 'monitor')
	if (!lookup.ready) return { setupOk: lookup.ready, reason: lookup.reason }

	const result = await lookup.handle.setupPackageContainerMonitors(packageContainer)

	if (result) return { setupOk: false, reason: result, monitors: {} }
	else return { setupOk: true } // all good
}
export async function disposePackageContainerMonitors(
	packageContainer: PackageContainerExpectation,
	genericWorker: GenericWorker
): Promise<ReturnTypeDisposePackageContainerMonitors> {
	const lookup = await lookupPackageContainer(genericWorker, packageContainer, 'monitor')
	if (!lookup.ready) return { disposed: lookup.ready, reason: lookup.reason }

	const result = await lookup.handle.disposePackageContainerMonitors(packageContainer)
	if (result) return { disposed: false, reason: result }
	else return { disposed: true } // all good
}

function checkWorkerHasAccessToPackageContainer(
	genericWorker: GenericWorker,
	containerId: string,
	packageContainer: PackageContainer
): ReturnTypeDoYouSupportPackageContainer {
	// Check that we have access to the packageContainers
	const accessSourcePackageContainer = findBestAccessorOnPackageContainer(
		genericWorker,
		containerId,
		packageContainer
	)
	if (accessSourcePackageContainer) {
		return {
			support: true,
			reason: `Has access to packageContainer "${accessSourcePackageContainer.packageContainer.label}" through accessor "${accessSourcePackageContainer.accessorId}"`,
		}
	} else {
		return {
			support: false,
			reason: `Doesn't have access to the packageContainer (${containerId})`,
		}
	}
}

async function lookupPackageContainer(
	worker: GenericWorker,
	packageContainer: PackageContainerExpectation,
	forWhat: 'cronjob' | 'monitor'
): Promise<LookupPackageContainer> {
	// Construct a fake PackageContainerOnPackage from the PackageContainer, so that we can use lookupAccessorHandles() later:
	const packageContainers: PackageContainerOnPackage[] = [
		{
			containerId: packageContainer.id,
			label: packageContainer.label,
			accessors: packageContainer.accessors as PackageContainerOnPackage['accessors'],
		},
	]

	return (await lookupAccessorHandles(
		worker,
		packageContainers,
		{
			// This is somewhat of a hack, it makes the AccessorHandlers to not look to close on the package-related content data,
			// in order to still be able to use them as-is for PackageContainer-related stuff.
			onlyContainerAccess: true,
		},
		{},
		forWhat == 'cronjob'
			? {
					read: true,
					write: true,
					writePackageContainer: true,
			  }
			: {
					read: true,
			  }
	)) as LookupPackageContainer
}
export type LookupPackageContainer =
	| {
			accessor: Accessor.Any
			handle: GenericAccessorHandle<void>
			ready: true
			reason: string
	  }
	| {
			accessor: undefined
			handle: undefined
			ready: false
			reason: string
	  }
