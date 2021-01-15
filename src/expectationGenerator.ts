import { Accessor, ExpectedPackage } from '@sofie-automation/blueprints-integration'
import { ExpectedPackageWrap } from './packageManager'
import { Expectation } from './worker/expectationApi'
import { hashObj } from './worker/lib/lib'

export interface ExpectedPackageWrapMediaFile extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageMediaFile
	sources: {
		label: string
		accessors: ExpectedPackage.ExpectedPackageMediaFile['sources'][0]['accessors']
	}[]
}
export interface ExpectedPackageWrapQuantel extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageQuantelClip
	sources: {
		label: string
		accessors: ExpectedPackage.ExpectedPackageQuantelClip['sources'][0]['accessors']
	}[]
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
						expWrapMediaFile.sources
					)}"`,
					requiredForPlayout: true,
					displayRank: 0,
				},

				startRequirement: {
					sources: expWrapMediaFile.sources,
				},

				endRequirement: {
					targets: expWrapMediaFile.targets as Expectation.PackageContainerOnPackageFile[],
					content: expWrapMediaFile.expectedPackage.content,
					version: expWrapMediaFile.expectedPackage.version,
				},
			}
			exp.id = hashObj(exp.endRequirement)

			// TODO: what should happen if there are several that have the same endRequirement? join sources?

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
					}", from ${expWrapQuantelClip.sources}`,
					requiredForPlayout: true,
					displayRank: 0,
				},

				startRequirement: {
					sources: expWrapQuantelClip.sources,
				},

				endRequirement: {
					targets: expWrapQuantelClip.targets as [Expectation.PackageContainerOnPackageQuantel],
					content: content,
					version: expWrapQuantelClip.expectedPackage.version,
				},
			}
			exp.id = hashObj(exp.endRequirement)

			// TODO: what should happen if there are several that have the same endRequirement? join sources?

			expectations[exp.id] = exp
		}
	}

	// Scan files:
	for (const id of Object.keys(expectations)) {
		const expectation = expectations[id]
		if (expectation.type === Expectation.Type.MEDIA_FILE_COPY) {
			// All files that have been copied should also be scanned:
			const scan: Expectation.MediaFileScan = {
				id: expectation.id + '_scan',
				type: Expectation.Type.MEDIA_FILE_SCAN,

				statusReport: {
					packageId: expectation.statusReport.packageId,
					label: `Scan ${expectation.statusReport.label}`,
					description: `Scanning is used to provide Sofie GUI with status about the media`,
					requiredForPlayout: false,
					displayRank: 10,
				},

				startRequirement: {
					sources: expectation.endRequirement.targets,
					content: expectation.endRequirement.content,
					version: expectation.endRequirement.version,
				},
				endRequirement: {
					targets: [
						{
							label: 'Core package info',
							accessors: {
								coreCollection: {
									type: Accessor.AccessType.CORE_PACKAGE_INFO,
								},
							},
						},
					],
					content: expectation.endRequirement.content,
					version: null, // expectation.endRequirement.version,
				},
				dependsOnFullfilled: [expectation.id],
				triggerByFullfilledIds: [expectation.id],
			}
			expectations[scan.id] = scan

			// All files that have been copied should also get a thumbnail:
			const thumbnail: Expectation.MediaFileThumbnail = {
				id: expectation.id + '_thumbnail',
				type: Expectation.Type.MEDIA_FILE_THUMBNAIL,

				statusReport: {
					packageId: expectation.statusReport.packageId,
					label: `Generate thumbnail for ${expectation.statusReport.label}`,
					description: `Thumbnail is used in Sofie GUI`,
					requiredForPlayout: false,
					displayRank: 11,
				},

				startRequirement: {
					sources: expectation.endRequirement.targets,
					content: expectation.endRequirement.content,
					version: expectation.endRequirement.version,
				},
				endRequirement: {
					targets: expectation.endRequirement.targets,
					content: {
						filePath: expectation.endRequirement.content.filePath.replace(/(\.[^.]+$)/, '.png'),
					},
					version: {
						width: 512,
						// height: auto
					},
				},
				dependsOnFullfilled: [expectation.id],
				triggerByFullfilledIds: [expectation.id],
			}
			expectations[thumbnail.id] = thumbnail
		}
	}

	return expectations
}
