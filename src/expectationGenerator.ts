import { ExpectedPackage, PackageOrigin } from '@sofie-automation/blueprints-integration'
import { ExpectedPackageWrap } from './packageManager'
import { Expectation } from './worker/expectationApi'
import { hashObj } from './worker/lib/lib'

export interface ExpectedPackageWrapMediaFile extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageMediaFile
	origins: ExpectedPackage.ExpectedPackageMediaFile['origins'][0]['originMetadata'][]
}
export interface ExpectedPackageWrapQuantel extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageQuantelClip
	origins: ExpectedPackage.ExpectedPackageQuantelClip['origins'][0]['originMetadata'][]
}

export function generateExpectations(expectedPackages: ExpectedPackageWrap[]): { [id: string]: Expectation.Any } {
	const expectations: { [id: string]: Expectation.Any } = {}

	// Note: All of this is a preliminary implementation!
	// A blueprint-like plug-in architecture might be a future idea

	for (const expWrap of expectedPackages) {
		if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
			const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

			const exp: Expectation.MediaFileCopy = {
				id: '', // set later
				type: Expectation.Type.MEDIA_FILE_COPY,
				statusReport: {
					packageId: expWrap.expectedPackage._id,
					label: `Copy media "${expWrapMediaFile.expectedPackage.content.filePath}"`,
					description: `Copy media "${
						expWrapMediaFile.expectedPackage.content.filePath
					}" to the playout-device "${expWrapMediaFile.playoutDeviceId}", from "${JSON.stringify(
						expWrapMediaFile.origins
					)}"`,
					requiredForPlayout: true,
					displayRank: 0,
				},

				startRequirement: {
					origins: expWrapMediaFile.origins,
				},

				endRequirement: {
					location: expWrapMediaFile.playoutLocation,
					content: expWrapMediaFile.expectedPackage.content,
					version: expWrapMediaFile.expectedPackage.version,
				},
			}
			exp.id = hashObj(exp.endRequirement)

			// TODO: what should happen if there are several that have the same endRequirement? join origins?

			expectations[exp.id] = exp
		} else if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.QUANTEL_CLIP) {
			const expWrapQuantelClip = expWrap as ExpectedPackageWrapQuantel

			const content = expWrapQuantelClip.expectedPackage.content
			const exp: Expectation.QuantelClipCopy = {
				id: '', // set later
				type: Expectation.Type.QUANTEL_COPY,

				statusReport: {
					packageId: expWrap.expectedPackage._id,
					label: `Copy Quantel clip ${content.title || content.guid}`,
					description: `Copy Quantel clip ${content.title || content.guid} to server for "${
						expWrapQuantelClip.playoutDeviceId
					}", from ${expWrapQuantelClip.origins}`,
					requiredForPlayout: true,
					displayRank: 0,
				},

				startRequirement: {
					origins: expWrapQuantelClip.origins,
				},

				endRequirement: {
					location: expWrapQuantelClip.playoutLocation, // todo
					content: content,
					version: expWrapQuantelClip.expectedPackage.version,
				},
			}
			exp.id = hashObj(exp.endRequirement)

			// TODO: what should happen if there are several that have the same endRequirement? join origins?

			expectations[exp.id] = exp
		}
	}

	// Scan files:
	for (const id of Object.keys(expectations)) {
		const expectation = expectations[id]
		if (expectation.type === Expectation.Type.MEDIA_FILE_COPY) {
			// All files that have been copied should also be scanned:

			const exp: Expectation.MediaFileScan = {
				id: expectation.id + '_scan',
				type: Expectation.Type.MEDIA_FILE_SCAN,

				statusReport: {
					packageId: expectation.statusReport.packageId,
					label: `Scan ${expectation.statusReport.label}`,
					description: `Scanning is used to provide Sofie GUI with status about the media`,
					requiredForPlayout: false,
					displayRank: 10,
				},

				startRequirement: expectation.endRequirement,

				endRequirement: {
					location: {
						type: PackageOrigin.OriginType.CORE_PACKAGE_INFO,
					},
					content: expectation.endRequirement.content,
					version: expectation.endRequirement.version,
				},
				dependsOnFullfilled: [expectation.id],
				triggerByFullfilledIds: [expectation.id],
			}
			expectations[exp.id] = exp
		}
	}

	return expectations
}
