import {
	Accessor,
	PackageContainer,
	PackageContainerOnPackage,
	PackageContainerExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeRunPackageContainerCronJob,
	Reason,
	assertNever,
	PackageContainerId,
	KnownReason,
} from '@sofie-package-manager/api'

import { GenericAccessorHandle, SetupPackageContainerMonitorsResult } from '../../accessorHandlers/genericHandle'
import { BaseWorker } from '../../worker'
import { lookupAccessorHandles, LookupChecks } from './expectationHandlers/lib'
import { findBestAccessorOnPackageContainer } from './lib/lib'

export async function doYouSupportPackageContainer(
	packageContainer: PackageContainerExpectation,
	genericWorker: BaseWorker
): Promise<ReturnTypeDoYouSupportPackageContainer> {
	return checkWorkerHasAccessToPackageContainer(genericWorker, packageContainer.id, packageContainer)
}
export async function runPackageContainerCronJob(
	packageContainer: PackageContainerExpectation,
	genericWorker: BaseWorker
): Promise<ReturnTypeRunPackageContainerCronJob> {
	const lookup = await lookupPackageContainer(genericWorker, packageContainer, 'cronjob')
	if (!lookup.ready) return { success: lookup.ready, knownReason: lookup.knownReason, reason: lookup.reason }

	const result = await lookup.handle.runCronJob(packageContainer)

	if (!result.success) return { success: false, knownReason: result.knownReason, reason: result.reason }
	else return { success: true } // all good
}
export async function setupPackageContainerMonitors(
	packageContainer: PackageContainerExpectation,
	genericWorker: BaseWorker
): Promise<SetupPackageContainerMonitorsResult> {
	const lookup = await lookupPackageContainer(genericWorker, packageContainer, 'monitor')
	if (!lookup.ready) return { success: lookup.ready, knownReason: lookup.knownReason, reason: lookup.reason }

	const result = await lookup.handle.setupPackageContainerMonitors(packageContainer)

	if (!result.success) return { success: false, reason: result.reason, knownReason: result.knownReason }
	else
		return {
			success: true,
			monitors: result.monitors,
		}
}

function checkWorkerHasAccessToPackageContainer(
	genericWorker: BaseWorker,
	containerId: PackageContainerId,
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
			// reason: `Has access to packageContainer "${accessSourcePackageContainer.packageContainer.label}" through accessor "${accessSourcePackageContainer.accessorId}"`,
		}
	} else {
		return {
			support: false,
			knownReason: true,
			reason: {
				user: `Worker doesn't support working with PackageContainer "${containerId}" (check settings?)`,
				tech: `Worker doesn't have any access to the PackageContainer "${containerId}"`,
			},
		}
	}
}

async function lookupPackageContainer(
	worker: BaseWorker,
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

	const checks: LookupChecks = {}
	if (forWhat === 'monitor') {
		checks.read = true
	} else if (forWhat === 'cronjob') {
		checks.read = true
		// If no cronjobs are setup, no need to check writability:
		if (Object.keys(packageContainer.cronjobs).length > 1) {
			checks.write = true
			checks.writePackageContainer = true
		}
	} else {
		assertNever(forWhat)
	}

	return (await lookupAccessorHandles(
		worker,
		packageContainers,
		{ packageContainerId: packageContainer.id },
		{
			// This is somewhat of a hack, it makes the AccessorHandlers to not look to close on the package-related content data,
			// in order to still be able to use them as-is for PackageContainer-related stuff.
			onlyContainerAccess: true,
		},
		{},
		checks
	)) as LookupPackageContainer
}
export type LookupPackageContainer =
	| {
			accessor: Accessor.Any
			handle: GenericAccessorHandle<void>
			ready: true
			reason: Reason
	  }
	| {
			accessor: undefined
			handle: undefined
			ready: false
			reason: Reason
			knownReason: KnownReason
	  }
