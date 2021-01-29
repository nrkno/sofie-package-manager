import { AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import { getAccessorHandle } from '../../../accessorHandlers/accessor'
import { prioritizeAccessors } from '../../../lib/lib'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import { GenericWorker } from '../../../worker'
import { compareActualExpectVersions, findBestPackageContainerWithAccess } from '../lib/lib'

/** Check that a worker has access to the packageContainers through its accessors */
export function checkWorkerHasAccessToPackageContainers(
	genericWorker: GenericWorker,
	checks: {
		sources?: PackageContainerOnPackage[]
		targets?: PackageContainerOnPackage[]
	}
): { support: boolean; reason: string } {
	let accessSourcePackageContainer: ReturnType<typeof findBestPackageContainerWithAccess>
	// Check that we have access to the packageContainers
	if (checks.sources !== undefined) {
		accessSourcePackageContainer = findBestPackageContainerWithAccess(genericWorker, checks.sources)
		if (!accessSourcePackageContainer) {
			return {
				support: false,
				reason: `Doesn't have access to any of the source packageContainers (${checks.sources
					.map((o) => o.containerId)
					.join(', ')})`,
			}
		}
	}

	let accessTargetPackageContainer: ReturnType<typeof findBestPackageContainerWithAccess>
	if (checks.targets !== undefined) {
		accessTargetPackageContainer = findBestPackageContainerWithAccess(genericWorker, checks.targets)
		if (!accessTargetPackageContainer) {
			return {
				support: false,
				reason: `Doesn't have access to any of the target packageContainers (${checks.targets
					.map((o) => o.containerId)
					.join(', ')})`,
			}
		}
	}

	const hasAccessTo: string[] = []
	if (accessSourcePackageContainer) {
		hasAccessTo.push(
			`source "${accessSourcePackageContainer.packageContainer.label}" through accessor "${accessSourcePackageContainer.accessorId}"`
		)
	}
	if (accessTargetPackageContainer) {
		hasAccessTo.push(
			`target "${accessTargetPackageContainer.packageContainer.label}" through accessor "${accessTargetPackageContainer.accessorId}"`
		)
	}

	return {
		support: true,
		reason: `Has access to ${hasAccessTo.join(' and ')}`,
	}
}

export type LookupPackageContainer<Metadata> =
	| {
			accessor: AccessorOnPackage.Any
			handle: GenericAccessorHandle<Metadata>
			ready: true
			reason: string
	  }
	| {
			accessor: undefined
			handle: undefined
			ready: false
			reason: string
	  }
interface LookupChecks {
	read?: boolean
	readPackage?: boolean
	packageVersion?: any

	write?: boolean
	writePackageContainer?: boolean
}
/** Go through the Accessors and return the best one that we can use for the expectation */
export async function lookupAccessorHandles<Metadata>(
	worker: GenericWorker,
	expectationAccessors: PackageContainerOnPackage[],
	expectationContent: unknown,
	checks: LookupChecks
): Promise<LookupPackageContainer<Metadata>> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const { packageContainer, accessorId, accessor } of prioritizeAccessors(expectationAccessors)) {
		errorReason = undefined

		const handle = getAccessorHandle<Metadata>(worker, accessor, expectationContent)

		if (checks.read) {
			// Check that the accessor-handle supports reading:
			const issueHandleRead = handle.checkHandleRead()
			if (issueHandleRead) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueHandleRead}`
				continue // Maybe next accessor works?
			}
		}

		if (checks.readPackage) {
			// Check that the Package can be read:
			const issuePackageReadAccess = await handle.checkPackageReadAccess()
			if (issuePackageReadAccess) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issuePackageReadAccess}`
				continue // Maybe next accessor works?
			}
		}
		if (checks.packageVersion !== undefined) {
			// Check that the version of the Package is correct:
			const actualSourceVersion = await handle.getPackageActualVersion()

			const issuePackageVersion = compareActualExpectVersions(actualSourceVersion, checks.packageVersion)
			if (issuePackageVersion) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issuePackageVersion}`
				continue // Maybe next accessor works?
			}
		}

		if (checks.write) {
			// Check that the accessor-handle supports writing:
			const issueHandleWrite = handle.checkHandleWrite()
			if (issueHandleWrite) {
				errorReason = `${packageContainer.label}: lookupTargets: Accessor "${accessorId}": ${issueHandleWrite}`
				continue // Maybe next accessor works?
			}
		}
		if (checks.writePackageContainer) {
			const issuePackage = await handle.checkPackageContainerWriteAccess()
			if (issuePackage) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issuePackage}`
				continue // Maybe next accessor works?
			}
		}

		if (!errorReason) {
			// All good, no need to look further:
			return {
				accessor: accessor,
				handle: handle,
				ready: true,
				reason: `Can access target "${packageContainer.label}" through accessor "${accessorId}"`,
			}
		}
	}
	return {
		accessor: undefined,
		handle: undefined,
		ready: false,
		reason: errorReason,
	}
}
