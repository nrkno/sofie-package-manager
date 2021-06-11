import {
	AccessorOnPackage,
	PackageContainer,
	PackageContainerOnPackage,
} from '@sofie-automation/blueprints-integration'
import { getAccessorCost, getAccessorStaticHandle } from '../../../accessorHandlers/accessor'
import { GenericWorker } from '../../../worker'
import { Expectation } from '@shared/api'
import { prioritizeAccessors } from '../../../lib/lib'
import { AccessorHandlerResult } from '../../../accessorHandlers/genericHandle'

export function compareActualExpectVersions(
	actualVersion: Expectation.Version.Any,
	expectVersion: Expectation.Version.ExpectAny
): AccessorHandlerResult {
	const expectProperties = makeUniversalVersion(expectVersion)
	const actualProperties = makeUniversalVersion(actualVersion)

	for (const key of Object.keys(expectProperties)) {
		const expect = expectProperties[key] as VersionProperty
		const actual = actualProperties[key] as VersionProperty

		if (expect.value !== undefined && actual.value && expect.value !== actual.value) {
			return {
				success: false,
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
): AccessorHandlerResult {
	for (const key of Object.keys(sourceVersion)) {
		const source = sourceVersion[key] as VersionProperty
		const target = targetVersion[key] as VersionProperty

		if (source.value !== target.value) {
			return {
				success: false,
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
export type VersionProperty = { name: string; value: string | number | undefined }

/** Looks through the packageContainers and return the first one we support access to. */
export function findBestPackageContainerWithAccessToPackage(
	worker: GenericWorker,
	packageContainers: PackageContainerOnPackage[]
): { packageContainer: PackageContainerOnPackage; accessor: AccessorOnPackage.Any; accessorId: string } | undefined {
	for (const { packageContainer, accessorId, accessor } of prioritizeAccessors(packageContainers)) {
		if (getAccessorStaticHandle(accessor).doYouSupportAccess(worker, accessor)) {
			return { packageContainer, accessor, accessorId }
		}
	}
	return undefined
}

/** Returns the best accessor for a packageContainer */
export function findBestAccessorOnPackageContainer(
	worker: GenericWorker,
	containerId: string,
	packageContainer: PackageContainer
): { packageContainer: PackageContainer; accessor: AccessorOnPackage.Any; accessorId: string } | undefined {
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
export function getStandardCost(exp: Expectation.Any, worker: GenericWorker): number {
	const source = findBestPackageContainerWithAccessToPackage(worker, exp.startRequirement.sources)
	const target = findBestPackageContainerWithAccessToPackage(worker, exp.endRequirement.targets)

	const sourceCost = source ? getAccessorCost(source.accessor.type) : Number.POSITIVE_INFINITY
	const targetCost = target ? getAccessorCost(target.accessor.type) : Number.POSITIVE_INFINITY

	return 30 * (sourceCost + targetCost)
}
