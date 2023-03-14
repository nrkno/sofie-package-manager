import { ExpectedPackageWrap } from '../../packageManager'
import { LoggerInstance } from '@sofie-package-manager/api'
import { ExpectedPackage } from '@sofie-package-manager/input-api'
import { ExpectedPackageWrapMediaFile, PriorityMagnitude } from './types'
import { SMARTBULL_STORAGE_ID } from './lib'

export function shouldBeIgnored(packageWrap: ExpectedPackageWrap): boolean {
	// Ignore the original smartbull package:
	if (expectedPackageIsSmartbull(packageWrap)) return true
	// Ignore any other files in the "source-smartbull"-container:
	else if (expectedPackageIsSmartbullSource(packageWrap)) return true
	else return false
}
export function expectedPackageIsSmartbull(packageWrap: ExpectedPackageWrap): boolean {
	return !!packageWrap.expectedPackage._id.match(/smartbull_auto_clip/)
}
export function expectedPackageIsSmartbullSource(packageWrap: ExpectedPackageWrap): boolean {
	if (expectedPackageIsSmartbull(packageWrap)) return false

	if (
		packageWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE &&
		packageWrap.sources.find((source) => source.containerId === SMARTBULL_STORAGE_ID)
	) {
		if ((packageWrap as ExpectedPackageWrapMediaFile).expectedPackage.content.filePath.match(/^smartbull/)) {
			// the files are on the form "smartbull_TIMESTAMP.mxf/mp4"
			return true
		}
	}
	return false
}

export function getSmartbullExpectedPackages(
	logger: LoggerInstance,
	expectedPackages: ExpectedPackageWrap[]
): ExpectedPackageWrapMediaFile[] {
	const orgSmartbullExpectedPackages: ExpectedPackageWrap[] = []

	// Find the smartbull package:
	for (const packageWrap of expectedPackages) {
		if (expectedPackageIsSmartbull(packageWrap)) {
			// hack
			orgSmartbullExpectedPackages.push(packageWrap)
		}
	}

	// Find smartbull source packages:
	const smartbullExpectations: ExpectedPackageWrapMediaFile[] = []
	for (const packageWrap of expectedPackages) {
		if (expectedPackageIsSmartbullSource(packageWrap)) {
			// Set the smartbull priority:
			packageWrap.priority = PriorityMagnitude.PLAY_SOON
			smartbullExpectations.push(packageWrap as ExpectedPackageWrapMediaFile)
		}
	}

	// Sort smartbulls alphabetically on filePath:
	smartbullExpectations.sort((a, b) => {
		// Lowest first:
		if (a.expectedPackage.content.filePath > b.expectedPackage.content.filePath) return 1
		if (a.expectedPackage.content.filePath < b.expectedPackage.content.filePath) return -1

		// Lowest first: (lower is better)
		if (a.priority > b.priority) return 1
		if (a.priority < b.priority) return -1

		return 0
	})
	// Pick the last one:
	const bestSmartbull =
		smartbullExpectations.length > 0 ? smartbullExpectations[smartbullExpectations.length - 1] : undefined

	if (!bestSmartbull) return []

	// Handle Smartbull:
	const smartbulls: ExpectedPackageWrapMediaFile[] = []
	for (const orgSmartbullExpectedPackage of orgSmartbullExpectedPackages) {
		if (orgSmartbullExpectedPackage.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
			const org = orgSmartbullExpectedPackage as ExpectedPackageWrapMediaFile

			const newPackage: ExpectedPackageWrapMediaFile = {
				...org,
				expectedPackage: {
					...org.expectedPackage,
					// Take these from bestSmartbull:
					content: bestSmartbull.expectedPackage.content,
					version: {}, // Don't even use bestSmartbull.expectedPackage.version,
					sources: bestSmartbull.expectedPackage.sources,
				},
			}
			smartbulls.push(newPackage)
		} else logger.warn('orgSmartbullExpectation is not a MEDIA_FILE')
	}
	return smartbulls
}
