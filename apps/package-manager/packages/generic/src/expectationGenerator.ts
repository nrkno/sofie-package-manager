import { Accessor, ExpectedPackage, PackageContainer } from '@sofie-automation/blueprints-integration'
import { ActivePlaylist, ActiveRundown, ExpectedPackageWrap, PackageContainers } from './packageManager'
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
	external?: boolean
}
export function generateExpectations(
	managerId: string,
	packageContainers: PackageContainers,
	_activePlaylist: ActivePlaylist,
	activeRundowns: ActiveRundown[],
	expectedPackages: ExpectedPackageWrap[]
): { [id: string]: Expectation.Any } {
	const expectations: { [id: string]: GenerateExpectation } = {}

	// Note: All of this is a preliminary implementation!
	// A blueprint-like plug-in architecture might be a future idea

	// Sort, so that we handle the high-prio first:
	expectedPackages.sort((a, b) => {
		// Lowest first: (lower is better)
		if (a.priority > b.priority) return 1
		if (a.priority < b.priority) return -1
		return 0
	})
	// Prepare:
	const activeRundownMap = new Map<string, ActiveRundown>()
	for (const activeRundown of activeRundowns) {
		activeRundownMap.set(activeRundown._id, activeRundown)
	}

	for (const expWrap of expectedPackages) {
		let exp: Expectation.Any | undefined = undefined

		if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
			exp = generateMediaFileCopy(managerId, expWrap)
		} else if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.QUANTEL_CLIP) {
			exp = generateQuantelCopy(managerId, expWrap)
		}
		if (exp) {
			// Prioritize
			/*
			0: Things that are to be played out like RIGHT NOW
			10: Things that are to be played out pretty soon (things that could be cued anytime now)
			100: Other things that affect users (GUI things)
			1000+: Other things that can be played out
			*/

			let prioAdd = 1000
			const activeRundown =
				expWrap.expectedPackage.rundownId && activeRundownMap.get(expWrap.expectedPackage.rundownId)
			if (activeRundown) {
				// The expected package is in an active rundown
				prioAdd = 0 + activeRundown._rank // Earlier rundowns should have higher priority
			}
			exp.priority += prioAdd

			const existingExp = expectations[exp.id]
			if (existingExp) {
				// There is already an expectation pointing at the same place.

				existingExp.priority = Math.min(existingExp.priority, exp.priority)

				const existingPackage = existingExp.fromPackages[0]
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
					existingExp.fromPackages.push(exp.fromPackages[0])
				}
			} else {
				expectations[exp.id] = {
					...exp,
					sideEffect: expWrap.expectedPackage.sideEffect,
					external: expWrap.external,
				}
			}
		}
	}

	// Side effects from files:
	for (const expectation0 of Object.values(expectations)) {
		if (expectation0.type === Expectation.Type.FILE_COPY) {
			const expectation = expectation0 as Expectation.FileCopy

			if (!expectation0.external) {
				// All files that have been copied should also be scanned:
				const scan = generateMediaFileScan(expectation)
				expectations[scan.id] = scan

				// All files that have been copied should also be deep-scanned:
				const deepScan = generateMediaFileDeepScan(expectation)
				expectations[deepScan.id] = deepScan
			}

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

function generateMediaFileCopy(managerId: string, expWrap: ExpectedPackageWrap): Expectation.FileCopy {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

	const exp: Expectation.FileCopy = {
		id: '', // set later
		priority: expWrap.priority * 10 || 0,
		managerId: managerId,
		fromPackages: [
			{
				id: expWrap.expectedPackage._id,
				expectedContentVersionHash: expWrap.expectedPackage.contentVersionHash,
			},
		],
		type: Expectation.Type.FILE_COPY,
		statusReport: {
			label: `Copy media "${expWrapMediaFile.expectedPackage.content.filePath}"`,
			description: `Copy media "${expWrapMediaFile.expectedPackage.content.filePath}" to the playout-device "${
				expWrapMediaFile.playoutDeviceId
			}", from "${JSON.stringify(expWrapMediaFile.sources)}"`,
			requiredForPlayout: true,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement: {
			targets: expWrapMediaFile.targets as [Expectation.PackageContainerOnPackageFile],
			content: expWrapMediaFile.expectedPackage.content,
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
				...expWrapMediaFile.expectedPackage.version,
			},
		},
	}
	exp.id = hashObj(exp.endRequirement)
	return exp
}
function generateQuantelCopy(managerId: string, expWrap: ExpectedPackageWrap): Expectation.QuantelClipCopy {
	const expWrapQuantelClip = expWrap as ExpectedPackageWrapQuantel

	const content = expWrapQuantelClip.expectedPackage.content
	const exp: Expectation.QuantelClipCopy = {
		id: '', // set later
		priority: expWrap.priority * 10 || 0,
		managerId: managerId,
		type: Expectation.Type.QUANTEL_CLIP_COPY,
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
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapQuantelClip.sources,
		},

		endRequirement: {
			targets: expWrapQuantelClip.targets as [Expectation.PackageContainerOnPackageQuantel],
			content: content,
			version: {
				type: Expectation.Version.Type.QUANTEL_CLIP,
				...expWrapQuantelClip.expectedPackage.version,
			},
		},
	}
	exp.id = hashObj(exp.endRequirement)

	return exp
}
function generateMediaFileScan(expectation: Expectation.FileCopy): Expectation.MediaFileScan {
	const scan: Expectation.MediaFileScan = {
		id: expectation.id + '_scan',
		priority: expectation.priority + 100,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Scan ${expectation.statusReport.label}`,
			description: `Scanning is used to provide Sofie GUI with status about the media`,
			requiredForPlayout: false,
			displayRank: 10,
			sendReport: expectation.statusReport.sendReport,
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
function generateMediaFileDeepScan(expectation: Expectation.FileCopy): Expectation.MediaFileDeepScan {
	const deepScan: Expectation.MediaFileDeepScan = {
		id: expectation.id + '_deepscan',
		priority: expectation.priority + 1001,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_DEEP_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Deep Scan ${expectation.statusReport.label}`,
			description: `Deep scanning includes scene-detection, black/freeze frames etc.`,
			requiredForPlayout: false,
			displayRank: 10,
			sendReport: expectation.statusReport.sendReport,
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
	expectation: Expectation.FileCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.MediaFileThumbnail {
	const thumbnail: Expectation.MediaFileThumbnail = {
		id: expectation.id + '_thumbnail',
		priority: expectation.priority + 1002,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_THUMBNAIL,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generate thumbnail for ${expectation.statusReport.label}`,
			description: `Thumbnail is used in Sofie GUI`,
			requiredForPlayout: false,
			displayRank: 11,
			sendReport: expectation.statusReport.sendReport,
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
				seekTime: settings.seekTime || 0,
			},
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	}

	return thumbnail
}
function generateMediaFilePreview(
	expectation: Expectation.FileCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.MediaFilePreview {
	const preview: Expectation.MediaFilePreview = {
		id: expectation.id + '_preview',
		priority: expectation.priority + 1003,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_PREVIEW,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generate preview for ${expectation.statusReport.label}`,
			description: `Preview is used in Sofie GUI`,
			requiredForPlayout: false,
			displayRank: 12,
			sendReport: expectation.statusReport.sendReport,
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

// function generateMediaFileHTTPCopy(expectation: Expectation.FileCopy): Expectation.FileCopy {
// 	// Copy file to HTTP: (TMP!)
// 	const tmpCopy: Expectation.FileCopy = {
// 		id: expectation.id + '_tmpCopy',
// 		priority: expectation.priority + 5,
//		managerId: expectation.managerId,
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
// 				type: Expectation.Version.Type.FILE_ON_DISK,
// 			},
// 		},
// 		dependsOnFullfilled: [expectation.id],
// 		triggerByFullfilledIds: [expectation.id],
// 	}

// 	return tmpCopy
// }
