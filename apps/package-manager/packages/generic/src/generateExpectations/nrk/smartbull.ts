import { ExpectedPackageWrap } from '../../packageManager'
import { ExpectedPackage, LoggerInstance } from '@sofie-package-manager/api'
import { ExpectedPackageWrapMediaFile, PriorityMagnitude } from './types'

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
		packageWrap.sources.find((source) => source.containerId === 'source-smartbull')
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
	let orgSmartbullExpectedPackage: ExpectedPackageWrap | undefined = undefined

	// Find the smartbull package:
	for (const packageWrap of expectedPackages) {
		if (expectedPackageIsSmartbull(packageWrap)) {
			// hack
			orgSmartbullExpectedPackage = packageWrap
		}
	}

	// Find smartbull source packages:
	const smartbullExpectations: ExpectedPackageWrap[] = []
	for (const packageWrap of expectedPackages) {
		if (expectedPackageIsSmartbullSource(packageWrap)) {
			// Set the smartbull priority:
			packageWrap.priority = PriorityMagnitude.PLAY_SOON
			smartbullExpectations.push(packageWrap)
		}
	}

	// Handle Smartbull:
	const smartbulls: ExpectedPackageWrapMediaFile[] = []
	if (orgSmartbullExpectedPackage && smartbullExpectations.length > 0) {
		// Sort alphabetically on filePath:
		smartbullExpectations.sort((a, b) => {
			const expA = a.expectedPackage as ExpectedPackage.ExpectedPackageMediaFile
			const expB = b.expectedPackage as ExpectedPackage.ExpectedPackageMediaFile

			// lowest first:
			if (expA.content.filePath > expB.content.filePath) return 1
			if (expA.content.filePath < expB.content.filePath) return -1

			return 0
		})
		// Pick the last one:
		const bestSmartbull = smartbullExpectations[smartbullExpectations.length - 1] as
			| ExpectedPackageWrapMediaFile
			| undefined
		if (bestSmartbull) {
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
	}
	return smartbulls
}
