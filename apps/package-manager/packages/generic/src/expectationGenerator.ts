import { Accessor, ExpectedPackage, PackageContainer } from '@sofie-automation/blueprints-integration'
import { ExpectedPackageWrap, PackageContainers } from './packageManager'
import { Expectation, hashObj } from '@shared/api'

export interface ExpectedPackageWrapMediaFile extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageMediaFile
	sources: {
		containerId: string
		label: string
		accessors: ExpectedPackage.ExpectedPackageMediaFile['sources'][0]['accessors']
	}[]
}
export interface ExpectedPackageWrapQuantel extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageQuantelClip
	sources: {
		containerId: string
		label: string
		accessors: ExpectedPackage.ExpectedPackageQuantelClip['sources'][0]['accessors']
	}[]
}

type GenerateExpectation = Expectation.Base & {
	sideEffect?: ExpectedPackage.Base['sideEffect']
}
export function generateExpectations(
	packageContainers: PackageContainers,
	expectedPackages: ExpectedPackageWrap[]
): { [id: string]: Expectation.Any } {
	const expectations: { [id: string]: GenerateExpectation } = {}

	// Note: All of this is a preliminary implementation!
	// A blueprint-like plug-in architecture might be a future idea

	for (const expWrap of expectedPackages) {
		let exp: Expectation.Any | undefined = undefined

		if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
			exp = generateMediaFileCopy(expWrap)
		} else if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.QUANTEL_CLIP) {
			exp = generateQuantelCopy(expWrap)
		}
		if (exp) {
			if (expectations[exp.id]) {
				// There is already an expectation pointing at the same place.

				const existingPackage = expectations[exp.id].fromPackages[0]
				const newPackage = exp.fromPackages[0]

				if (existingPackage.expectedContentVersionHash !== newPackage.expectedContentVersionHash) {
					// log warning:
					console.log(
						`WARNING: 2 expectedPackages have the same content, but have different contentVersions!`
					)
					console.log(`"${existingPackage.id}": ${existingPackage.expectedContentVersionHash}`)
					console.log(`"${newPackage.id}": ${newPackage.expectedContentVersionHash}`)
					console.log(`${JSON.stringify(exp.startRequirement)}`)

					// TODO: log better warnings!
				} else {
					expectations[exp.id].fromPackages.push(exp.fromPackages[0])
				}
			} else {
				expectations[exp.id] = {
					...exp,
					sideEffect: expWrap.expectedPackage.sideEffect,
				}
			}
		}
	}

	// Side effects from files:
	for (const expectation0 of Object.values(expectations)) {
		if (expectation0.type === Expectation.Type.MEDIA_FILE_COPY) {
			const expectation = expectation0 as Expectation.MediaFileCopy

			// All files that have been copied should also be scanned:
			const scan = generateMediaFileScan(expectation)
			expectations[scan.id] = scan

			// All files that have been copied should also be deep-scanned:
			const deepScan = generateMediaFileDeepScan(expectation)
			expectations[deepScan.id] = deepScan

			if (expectation0.sideEffect?.thumbnailContainerId && expectation0.sideEffect?.thumbnailPackageSettings) {
				const packageContainer: PackageContainer =
					packageContainers[expectation0.sideEffect.thumbnailContainerId]

				const thumbnail = generateMediaFileThumbnail(
					expectation,
					expectation0.sideEffect.thumbnailContainerId,
					expectation0.sideEffect.thumbnailPackageSettings,
					packageContainer
				)
				expectations[thumbnail.id] = thumbnail
			}

			if (expectation0.sideEffect?.previewContainerId && expectation0.sideEffect?.previewPackageSettings) {
				const packageContainer: PackageContainer = packageContainers[expectation0.sideEffect.previewContainerId]

				const preview = generateMediaFilePreview(
					expectation,
					expectation0.sideEffect.previewContainerId,
					expectation0.sideEffect.previewPackageSettings,
					packageContainer
				)
				expectations[preview.id] = preview
			}

			// const tmpCopy = generateMediaFileHTTPCopy(expectation)
			// expectations[tmpCopy.id] = tmpCopy
		}
	}

	const returnExpectations: { [id: string]: Expectation.Any } = {}
	for (const [id, exp] of Object.entries(expectations)) {
		returnExpectations[id] = exp as any
	}

	return returnExpectations
}

function generateMediaFileCopy(expWrap: ExpectedPackageWrap): Expectation.MediaFileCopy {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

	const exp: Expectation.MediaFileCopy = {
		id: '', // set later
		priority: 10,
		fromPackages: [
			{
				id: expWrap.expectedPackage._id,
				expectedContentVersionHash: expWrap.expectedPackage.contentVersionHash,
			},
		],
		type: Expectation.Type.MEDIA_FILE_COPY,
		statusReport: {
			label: `Copy media "${expWrapMediaFile.expectedPackage.content.filePath}"`,
			description: `Copy media "${expWrapMediaFile.expectedPackage.content.filePath}" to the playout-device "${
				expWrapMediaFile.playoutDeviceId
			}", from "${JSON.stringify(expWrapMediaFile.sources)}"`,
			requiredForPlayout: true,
			displayRank: 0,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement: {
			targets: expWrapMediaFile.targets as [Expectation.PackageContainerOnPackageFile],
			content: expWrapMediaFile.expectedPackage.content,
			version: {
				type: Expectation.Version.Type.MEDIA_FILE,
				...expWrapMediaFile.expectedPackage.version,
			},
		},
	}
	exp.id = hashObj(exp.endRequirement)
	return exp
}
function generateQuantelCopy(expWrap: ExpectedPackageWrap): Expectation.QuantelClipCopy {
	const expWrapQuantelClip = expWrap as ExpectedPackageWrapQuantel

	const content = expWrapQuantelClip.expectedPackage.content
	const exp: Expectation.QuantelClipCopy = {
		id: '', // set later
		priority: 10,
		type: Expectation.Type.QUANTEL_COPY,
		fromPackages: [
			{
				id: expWrap.expectedPackage._id,
				expectedContentVersionHash: expWrap.expectedPackage.contentVersionHash,
			},
		],

		statusReport: {
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

	return exp
}
function generateMediaFileScan(expectation: Expectation.MediaFileCopy): Expectation.MediaFileScan {
	const scan: Expectation.MediaFileScan = {
		id: expectation.id + '_scan',
		priority: 100,
		type: Expectation.Type.MEDIA_FILE_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
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
					containerId: '__corePackageInfo',
					label: 'Core package info',
					accessors: {
						coreCollection: {
							type: Accessor.AccessType.CORE_PACKAGE_INFO,
						},
					},
				},
			],
			content: expectation.endRequirement.content,
			version: null,
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	}

	return scan
}
function generateMediaFileDeepScan(expectation: Expectation.MediaFileCopy): Expectation.MediaFileDeepScan {
	const deepScan: Expectation.MediaFileDeepScan = {
		id: expectation.id + '_deepscan',
		priority: 201,
		type: Expectation.Type.MEDIA_FILE_DEEP_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Deep Scan ${expectation.statusReport.label}`,
			description: `Deep scanning includes scene-detection, black/freeze frames etc.`,
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
					containerId: '__corePackageInfo',
					label: 'Core package info',
					accessors: {
						coreCollection: {
							type: Accessor.AccessType.CORE_PACKAGE_INFO,
						},
					},
				},
			],
			content: expectation.endRequirement.content,
			version: {
				fieldOrder: true,
				scenes: true,
				freezeDetection: true,
				blackDetection: true,
			},
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	}

	return deepScan
}

function generateMediaFileThumbnail(
	expectation: Expectation.MediaFileCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.MediaFileThumbnail {
	const thumbnail: Expectation.MediaFileThumbnail = {
		id: expectation.id + '_thumbnail',
		priority: 200,
		type: Expectation.Type.MEDIA_FILE_THUMBNAIL,
		fromPackages: expectation.fromPackages,

		statusReport: {
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
			targets: [
				{
					...(packageContainer as any),
					containerId: packageContainerId,
				},
			],
			content: {
				filePath: settings.path,
			},
			version: {
				type: Expectation.Version.Type.MEDIA_FILE_THUMBNAIL,
				width: 512,
				height: -1, // preserve ratio
			},
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	}

	return thumbnail
}
function generateMediaFilePreview(
	expectation: Expectation.MediaFileCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.MediaFilePreview {
	const preview: Expectation.MediaFilePreview = {
		id: expectation.id + '_preview',
		priority: 200,
		type: Expectation.Type.MEDIA_FILE_PREVIEW,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generate preview for ${expectation.statusReport.label}`,
			description: `Preview is used in Sofie GUI`,
			requiredForPlayout: false,
			displayRank: 12,
		},

		startRequirement: {
			sources: expectation.endRequirement.targets,
			content: expectation.endRequirement.content,
			version: expectation.endRequirement.version,
		},
		endRequirement: {
			targets: [
				{
					...(packageContainer as any),
					containerId: packageContainerId,
				},
			],
			content: {
				filePath: settings.path,
			},
			version: {
				type: Expectation.Version.Type.MEDIA_FILE_PREVIEW,
				// width: 512,
				// height: -1, // preserve ratio
			},
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	}
	return preview
}

// function generateMediaFileHTTPCopy(expectation: Expectation.MediaFileCopy): Expectation.MediaFileCopy {
// 	// Copy file to HTTP: (TMP!)
// 	const tmpCopy: Expectation.MediaFileCopy = {
// 		id: expectation.id + '_tmpCopy',
// 		priority: expectation.priority + 1,
// 		type: Expectation.Type.MEDIA_FILE_COPY,
// 		fromPackages: expectation.fromPackages,

// 		statusReport: {
// 			label: `TMP: copy to http for ${expectation.statusReport.label}`,
// 			description: ``,
// 			requiredForPlayout: false,
// 			displayRank: 12,
// 		},

// 		startRequirement: {
// 			sources: expectation.endRequirement.targets,
// 		},
// 		endRequirement: {
// 			targets: [
// 				{
// 					label: 'local http',
// 					containerId: 'proxy1',
// 					accessors: {
// 						http: {
// 							type: Accessor.AccessType.HTTP,
// 							baseUrl: 'http://localhost:8080/package/',
// 							url: expectation.endRequirement.content.filePath,
// 							allowRead: true,
// 							allowWrite: true,
// 						},
// 					},
// 				},
// 			],
// 			content: expectation.endRequirement.content,
// 			version: {
// 				type: Expectation.Version.Type.MEDIA_FILE,
// 			},
// 		},
// 		dependsOnFullfilled: [expectation.id],
// 		triggerByFullfilledIds: [expectation.id],
// 	}

// 	return tmpCopy
// }
