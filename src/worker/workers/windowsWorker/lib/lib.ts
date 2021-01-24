import { AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import { getAccessorHandle } from '../../../accessorHandlers/accessor'
import { GenericWorker } from '../../../worker'
import { Expectation } from '../../../expectationApi'
import { prioritizeAccessors } from '../../../lib/lib'

export function compareActualExpectVersions(
	actualVersion: Expectation.Version.Any,
	expectVersion: Expectation.Version.ExpectAny
): undefined | string {
	const expectProperties = makeUniversalVersion(expectVersion)
	const actualProperties = makeUniversalVersion(actualVersion)

	for (const key of Object.keys(expectProperties)) {
		const expect = expectProperties[key] as VersionProperty
		const actual = actualProperties[key] as VersionProperty

		if (expect.value !== undefined && actual.value && expect.value !== actual.value) {
			return `Actual ${actual.name} differ from expected (${expect.value}, ${actual.value})`
		}
	}

	return undefined // All good!
}
export function compareUniversalVersions(
	sourceVersion: UniversalVersion,
	targetVersion: UniversalVersion
): undefined | string {
	for (const key of Object.keys(sourceVersion)) {
		const source = sourceVersion[key] as VersionProperty
		const target = targetVersion[key] as VersionProperty

		if (source.value !== target.value) {
			return `Target ${source.name} differ from source (${target.value}, ${source.value})`
		}
	}
	return undefined // All good!
}

export function makeUniversalVersion(
	version: Expectation.Version.Any | Expectation.Version.ExpectAny
): UniversalVersion {
	if (![Expectation.Version.Type.MEDIA_FILE, Expectation.Version.Type.HTTP_FILE].includes(version.type)) {
		throw new Error(`getAllVersionProperties: Unsupported types "${version.type}"-"${version.type}"`)
	}

	// Note: When having added a new type below, add it to the list of supported types above to enable support for it

	return {
		fileSize: {
			name: 'File size',
			value:
				version.type === Expectation.Version.Type.MEDIA_FILE
					? version.fileSize
					: version.type === Expectation.Version.Type.HTTP_FILE
					? version.contentLength
					: undefined,
		},

		modified: {
			name: 'Modified date',
			value:
				version.type === Expectation.Version.Type.MEDIA_FILE
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
export function findBestPackageContainerWithAccess(
	worker: GenericWorker,
	packageContainers: PackageContainerOnPackage[]
): { packageContainer: PackageContainerOnPackage; accessor: AccessorOnPackage.Any; accessorId: string } | undefined {
	for (const { packageContainer, accessorId, accessor } of prioritizeAccessors(packageContainers)) {
		if (getAccessorHandle(worker, accessor, {}).doYouSupportAccess()) {
			return { packageContainer, accessor, accessorId }
		}
	}
	return undefined
}
