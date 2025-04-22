import { getAccessorCost, getAccessorStaticHandle } from '../../../accessorHandlers/accessor'
import { BaseWorker } from '../../../worker'
import {
	AccessorOnPackage,
	PackageContainer,
	PackageContainerOnPackage,
	Expectation,
	ReturnTypeGetCostFortExpectation,
	PackageContainerId,
	AccessorId,
	Cost,
} from '@sofie-package-manager/api'
import { prioritizeAccessors } from '../../../lib/lib'
import { AccessorHandlerResultGeneric } from '../../../accessorHandlers/genericHandle'

export function compareActualExpectVersions(
	actualVersion: Expectation.Version.Any,
	expectVersion: Expectation.Version.ExpectAny
): AccessorHandlerResultGeneric {
	const expectProperties = makeUniversalVersion(expectVersion)
	const actualProperties = makeUniversalVersion(actualVersion)

	for (const key of Object.keys(expectProperties)) {
		const expect = expectProperties[key]
		const actual = actualProperties[key]

		if (expect.value !== undefined && actual.value && expect.value !== actual.value) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: 'Actual version differs from expected',
					tech: `Actual ${actual.name} differ from expected (${expect.value}, ${actual.value})`,
				},
			}
		}
	}

	return { success: true }
}
export function compareUniversalVersions(
	sourceVersion: UniversalVersion,
	targetVersion: UniversalVersion
): AccessorHandlerResultGeneric {
	for (const key of Object.keys(sourceVersion)) {
		const source = sourceVersion[key]
		const target = targetVersion[key]

		if (source.omit || target.omit) continue // skip that comparison

		if (source.value !== target.value) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: 'Target version differs from Source',
					tech: `Target ${source.name} differ from source (${target.value}, ${source.value})`,
				},
			}
		}
	}
	return { success: true }
}

export function makeUniversalVersion(
	version: Expectation.Version.Any | Expectation.Version.ExpectAny
): UniversalVersion {
	if (
		![
			Expectation.Version.Type.FILE_ON_DISK,
			Expectation.Version.Type.HTTP_FILE,
			Expectation.Version.Type.QUANTEL_CLIP,
			Expectation.Version.Type.JSON_DATA,
		].includes(version.type)
	) {
		throw new Error(`getAllVersionProperties: Unsupported type "${version.type}"`)
	}

	// Note: When having added a new type below, add it to the list of supported types above to enable support for it

	const uVersion: UniversalVersion = {
		fileSize: {
			name: 'File size',
			value:
				version.type === Expectation.Version.Type.FILE_ON_DISK
					? version.fileSize
					: version.type === Expectation.Version.Type.HTTP_FILE
					? version.contentLength
					: version.type === Expectation.Version.Type.JSON_DATA
					? version.size
					: undefined,
		},

		modified: {
			name: 'Modified date',
			value:
				version.type === Expectation.Version.Type.FILE_ON_DISK
					? version.modifiedDate
					: version.type === Expectation.Version.Type.HTTP_FILE
					? version.modified
					: undefined,
		},
		etags: {
			name: 'http-etags',
			value: version.type === Expectation.Version.Type.HTTP_FILE ? version.etags?.join() : undefined,
		},
		contentType: {
			name: 'content type',
			value: version.type === Expectation.Version.Type.HTTP_FILE ? version.contentType : undefined,
		},
	}
	if (version.type === Expectation.Version.Type.QUANTEL_CLIP) {
		uVersion['quantel_cloneId'] = {
			name: 'Clip.cloneID',
			value: version.cloneId,
		}
	}
	return uVersion
}
export interface UniversalVersion {
	fileSize: VersionProperty
	modified: VersionProperty
	etags: VersionProperty
	contentType: VersionProperty
	[key: string]: VersionProperty
}
export type VersionProperty = { name: string; value: string | number | undefined; omit?: boolean }

/** Looks through the packageContainers and return the first one we support access to. */
export function findBestPackageContainerWithAccessToPackage(
	worker: BaseWorker,
	packageContainers: PackageContainerOnPackage[]
):
	| { packageContainer: PackageContainerOnPackage; accessor: AccessorOnPackage.Any; accessorId: AccessorId }
	| undefined {
	for (const { packageContainer, accessorId, accessor } of prioritizeAccessors(packageContainers)) {
		if (getAccessorStaticHandle(accessor).doYouSupportAccess(worker, accessor)) {
			return { packageContainer, accessor, accessorId }
		}
	}
	return undefined
}

/** Returns the best accessor for a packageContainer */
export function findBestAccessorOnPackageContainer(
	worker: BaseWorker,
	containerId: PackageContainerId,
	packageContainer: PackageContainer
): { packageContainer: PackageContainer; accessor: AccessorOnPackage.Any; accessorId: AccessorId } | undefined {
	// Construct a fake PackageContainerOnPackage from the PackageContainer, so that we can use prioritizeAccessors() later:
	const packageContainers: PackageContainerOnPackage[] = [
		{
			containerId: containerId,
			label: packageContainer.label,
			accessors: packageContainer.accessors as any,
		},
	]
	for (const { accessorId, accessor } of prioritizeAccessors(packageContainers)) {
		if (getAccessorStaticHandle(accessor).doYouSupportAccess(worker, accessor)) {
			return { packageContainer, accessor, accessorId }
		}
	}
	return undefined
}
/** Return a standard cost for the various accessorHandler types */
export function getStandardCost(exp: Expectation.Any, worker: BaseWorker): ReturnTypeGetCostFortExpectation {
	// null means that the cost is "infinite"
	let sourceCost: Cost
	if (exp.startRequirement.sources.length > 0) {
		const source = findBestPackageContainerWithAccessToPackage(worker, exp.startRequirement.sources)
		sourceCost = source ? getAccessorCost(source.accessor.type) : null
	} else {
		// If there are no sources defined, there is no cost for the source
		sourceCost = 0
	}

	const target = findBestPackageContainerWithAccessToPackage(worker, exp.endRequirement.targets)
	const targetCost: Cost = target ? getAccessorCost(target.accessor.type) : null

	const resultingCost: Cost = sourceCost !== null && targetCost !== null ? 30 * (sourceCost + targetCost) : null

	return {
		cost: resultingCost,
		reason: {
			user: `Source cost: ${sourceCost}, Target cost: ${targetCost}`,
			tech: `Source cost: ${sourceCost}, Target cost: ${targetCost}`,
		},
	}
}
/**
 * Compares two networkIds/resourceIds.
 * It is a forgiving comparison, returning true either of the two is not defined.
 * @returns true if equal
 */
export function compareResourceIds(
	resourceId0?: string | number | null,
	resourceId1?: string | number | null
): boolean {
	// If one of them are not set, no need to do the comparison:
	if (resourceId0 === undefined || resourceId0 === null || resourceId0 === '') return true
	if (resourceId1 === undefined || resourceId1 === null || resourceId1 === '') return true

	// Do a textual comparison
	return `${resourceId0}` === `${resourceId1}`
}
