import { Accessor, ExpectedPackage, PackageContainer } from '@sofie-automation/blueprints-integration'
import {
	ActivePlaylist,
	ActiveRundown,
	ExpectedPackageWrap,
	PackageContainers,
	PackageManagerSettings,
} from './packageManager'
import { Expectation, hashObj, PackageContainerExpectation, literal, LoggerInstance } from '@shared/api'

export interface ExpectedPackageWrapMediaFile extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageMediaFile
	sources: {
		containerId: string
		label: string
		accessors: NonNullable<ExpectedPackage.ExpectedPackageMediaFile['sources'][0]['accessors']>
	}[]
}
export interface ExpectedPackageWrapQuantel extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageQuantelClip
	sources: {
		containerId: string
		label: string
		accessors: NonNullable<ExpectedPackage.ExpectedPackageQuantelClip['sources'][0]['accessors']>
	}[]
}
export interface ExpectedPackageWrapJSONData extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageJSONData
	sources: {
		containerId: string
		label: string
		accessors: NonNullable<ExpectedPackage.ExpectedPackageJSONData['sources'][0]['accessors']>
	}[]
}

type GenerateExpectation = Expectation.Base & {
	sideEffect?: ExpectedPackage.Base['sideEffect']
	external?: boolean
}
export function generateExpectations(
	logger: LoggerInstance,
	managerId: string,
	packageContainers: PackageContainers,
	_activePlaylist: ActivePlaylist,
	activeRundowns: ActiveRundown[],
	expectedPackages: ExpectedPackageWrap[],
	settings: PackageManagerSettings
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

	function prioritizeExpectation(packageWrap: ExpectedPackageWrap, exp: Expectation.Any): void {
		// Prioritize
		/*
		0: Things that are to be played out like RIGHT NOW
		10: Things that are to be played out pretty soon (things that could be cued anytime now)
		100: Other things that affect users (GUI things)
		1000+: Other things that can be played out
		*/

		let prioAdd = 1000
		const activeRundown: ActiveRundown | undefined = packageWrap.expectedPackage.rundownId
			? activeRundownMap.get(packageWrap.expectedPackage.rundownId)
			: undefined

		if (activeRundown) {
			// The expected package is in an active rundown
			prioAdd = 0 + activeRundown._rank // Earlier rundowns should have higher priority
		}
		exp.priority += prioAdd
	}
	function addExpectation(packageWrap: ExpectedPackageWrap, exp: Expectation.Any) {
		const existingExp = expectations[exp.id]
		if (existingExp) {
			// There is already an expectation pointing at the same place.

			existingExp.priority = Math.min(existingExp.priority, exp.priority)

			const existingPackage = existingExp.fromPackages[0]
			const newPackage = exp.fromPackages[0]

			if (existingPackage.expectedContentVersionHash !== newPackage.expectedContentVersionHash) {
				// log warning:
				logger.warn(`WARNING: 2 expectedPackages have the same content, but have different contentVersions!`)
				logger.warn(`"${existingPackage.id}": ${existingPackage.expectedContentVersionHash}`)
				logger.warn(`"${newPackage.id}": ${newPackage.expectedContentVersionHash}`)
				logger.warn(`${JSON.stringify(exp.startRequirement)}`)

				// TODO: log better warnings!
			} else {
				existingExp.fromPackages.push(exp.fromPackages[0])
			}
		} else {
			expectations[exp.id] = {
				...exp,
				sideEffect: packageWrap.expectedPackage.sideEffect,
				external: packageWrap.external,
			}
		}
	}

	const smartbullExpectations: ExpectedPackageWrap[] = [] // Hack, Smartbull
	let orgSmartbullExpectation: ExpectedPackageWrap | undefined = undefined // Hack, Smartbull

	for (const packageWrap of expectedPackages) {
		let exp: Expectation.Any | undefined = undefined

		// Temporary hacks: handle smartbull:
		if (packageWrap.expectedPackage._id.match(/smartbull_auto_clip/)) {
			// hack
			orgSmartbullExpectation = packageWrap
			continue
		}
		if (
			packageWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE &&
			packageWrap.sources.find((source) => source.containerId === 'source-smartbull')
		) {
			if ((packageWrap as ExpectedPackageWrapMediaFile).expectedPackage.content.filePath.match(/^smartbull/)) {
				// the files are on the form "smartbull_TIMESTAMP.mxf/mp4"
				smartbullExpectations.push(packageWrap)
			}
			// (any other files in the "source-smartbull"-container are to be ignored)
			continue
		}

		if (packageWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
			exp = generateMediaFileCopy(managerId, packageWrap, settings)
		} else if (packageWrap.expectedPackage.type === ExpectedPackage.PackageType.QUANTEL_CLIP) {
			exp = generateQuantelCopy(managerId, packageWrap)
		} else if (packageWrap.expectedPackage.type === ExpectedPackage.PackageType.JSON_DATA) {
			exp = generateJsonDataCopy(managerId, packageWrap, settings)
		}
		if (exp) {
			prioritizeExpectation(packageWrap, exp)
			addExpectation(packageWrap, exp)
		}
	}

	// hack: handle Smartbull:
	if (orgSmartbullExpectation) {
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
			if (orgSmartbullExpectation.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
				const org = orgSmartbullExpectation as ExpectedPackageWrapMediaFile

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
				const exp = generateMediaFileCopy(managerId, newPackage, settings)
				if (exp) {
					prioritizeExpectation(newPackage, exp)
					addExpectation(newPackage, exp)
				}
			} else logger.warn('orgSmartbullExpectation is not a MEDIA_FILE')
		}
	}

	// Side effects from files:
	for (const expectation0 of Object.values(expectations)) {
		if (expectation0.type === Expectation.Type.FILE_COPY) {
			const expectation = expectation0 as Expectation.FileCopy

			if (!expectation0.external) {
				// All files that have been copied should also be scanned:
				const scan = generatePackageScan(expectation)
				expectations[scan.id] = scan

				// All files that have been copied should also be deep-scanned:
				const deepScan = generatePackageDeepScan(expectation)
				expectations[deepScan.id] = deepScan
			}

			if (expectation0.sideEffect?.thumbnailContainerId && expectation0.sideEffect?.thumbnailPackageSettings) {
				const packageContainer = packageContainers[expectation0.sideEffect.thumbnailContainerId] as
					| PackageContainer
					| undefined

				if (packageContainer) {
					const thumbnail = generateMediaFileThumbnail(
						expectation,
						expectation0.sideEffect.thumbnailContainerId,
						expectation0.sideEffect.thumbnailPackageSettings,
						packageContainer
					)
					expectations[thumbnail.id] = thumbnail
				}
			}

			if (expectation0.sideEffect?.previewContainerId && expectation0.sideEffect?.previewPackageSettings) {
				const packageContainer = packageContainers[expectation0.sideEffect.previewContainerId] as
					| PackageContainer
					| undefined

				if (packageContainer) {
					const preview = generateMediaFilePreview(
						expectation,
						expectation0.sideEffect.previewContainerId,
						expectation0.sideEffect.previewPackageSettings,
						packageContainer
					)
					expectations[preview.id] = preview
				}
			}
		} else if (expectation0.type === Expectation.Type.QUANTEL_CLIP_COPY) {
			const expectation = expectation0 as Expectation.QuantelClipCopy

			if (!expectation0.external) {
				// All files that have been copied should also be scanned:
				const scan = generatePackageScan(expectation)
				expectations[scan.id] = scan

				// All files that have been copied should also be deep-scanned:
				const deepScan = generatePackageDeepScan(expectation)
				expectations[deepScan.id] = deepScan
			}

			if (expectation0.sideEffect?.thumbnailContainerId && expectation0.sideEffect?.thumbnailPackageSettings) {
				const packageContainer = packageContainers[expectation0.sideEffect.thumbnailContainerId] as
					| PackageContainer
					| undefined

				if (packageContainer) {
					const thumbnail = generateQuantelClipThumbnail(
						expectation,
						expectation0.sideEffect.thumbnailContainerId,
						expectation0.sideEffect.thumbnailPackageSettings,
						packageContainer
					)
					expectations[thumbnail.id] = thumbnail
				}
			}

			if (expectation0.sideEffect?.previewContainerId && expectation0.sideEffect?.previewPackageSettings) {
				const packageContainer = packageContainers[expectation0.sideEffect.previewContainerId] as
					| PackageContainer
					| undefined

				if (packageContainer) {
					const preview = generateQuantelClipPreview(
						expectation,
						expectation0.sideEffect.previewContainerId,
						expectation0.sideEffect.previewPackageSettings,
						packageContainer
					)
					expectations[preview.id] = preview
				}
			}
		}
	}

	const returnExpectations: { [id: string]: Expectation.Any } = {}
	for (const [id, exp] of Object.entries(expectations)) {
		returnExpectations[id] = exp as any
	}

	return returnExpectations
}

function generateMediaFileCopy(
	managerId: string,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.FileCopy {
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
			label: `Copying media "${expWrapMediaFile.expectedPackage.content.filePath}"`,
			description: `Copy media file "${expWrapMediaFile.expectedPackage.content.filePath}" to the device "${
				expWrapMediaFile.playoutDeviceId
			}", from ${expWrapMediaFile.sources.map((source) => `"${source.label}"`).join(', ')}`,
			requiredForPlayout: true,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement: {
			targets: expWrapMediaFile.targets as [Expectation.SpecificPackageContainerOnPackage.File],
			content: expWrapMediaFile.expectedPackage.content,
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
				...expWrapMediaFile.expectedPackage.version,
			},
		},
		workOptions: {
			removeDelay: settings.delayRemoval,
			useTemporaryFilePath: settings.useTemporaryFilePath,
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
			}", from ${expWrapQuantelClip.sources.map((source) => `"${source.label}"`).join(', ')}`,
			requiredForPlayout: true,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapQuantelClip.sources,
		},

		endRequirement: {
			targets: expWrapQuantelClip.targets as [Expectation.SpecificPackageContainerOnPackage.QuantelClip],
			content: content,
			version: {
				type: Expectation.Version.Type.QUANTEL_CLIP,
				...expWrapQuantelClip.expectedPackage.version,
			},
		},
		workOptions: {
			// removeDelay: 0 // Not used by Quantel
		},
	}
	exp.id = hashObj(exp.endRequirement)

	return exp
}
function generatePackageScan(expectation: Expectation.FileCopy | Expectation.QuantelClipCopy): Expectation.PackageScan {
	return literal<Expectation.PackageScan>({
		id: expectation.id + '_scan',
		priority: expectation.priority + 100,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Scanning`,
			description: `Scanning the media, to provide data to the Sofie GUI`,
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
			content: null,
			version: null,
		},
		workOptions: {
			...expectation.workOptions,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}
function generatePackageDeepScan(
	expectation: Expectation.FileCopy | Expectation.QuantelClipCopy
): Expectation.PackageDeepScan {
	return literal<Expectation.PackageDeepScan>({
		id: expectation.id + '_deepscan',
		priority: expectation.priority + 1001,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_DEEP_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Deep Scanning`,
			description: `Detecting scenes, black frames, freeze frames etc.`,
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
					containerId: '__corePackageInfo',
					label: 'Core package info',
					accessors: {
						coreCollection: {
							type: Accessor.AccessType.CORE_PACKAGE_INFO,
						},
					},
				},
			],
			content: null,
			version: {
				fieldOrder: true,
				scenes: true,
				freezeDetection: true,
				blackDetection: true,
			},
		},
		workOptions: {
			...expectation.workOptions,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}

function generateMediaFileThumbnail(
	expectation: Expectation.FileCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.MediaFileThumbnail {
	return literal<Expectation.MediaFileThumbnail>({
		id: expectation.id + '_thumbnail',
		priority: expectation.priority + 1002,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_THUMBNAIL,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating thumbnail`,
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
		workOptions: {
			...expectation.workOptions,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}
function generateMediaFilePreview(
	expectation: Expectation.FileCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.MediaFilePreview {
	return literal<Expectation.MediaFilePreview>({
		id: expectation.id + '_preview',
		priority: expectation.priority + 1003,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_PREVIEW,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating preview`,
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
				filePath: settings.path || expectation.endRequirement.content.filePath,
			},
			version: {
				type: Expectation.Version.Type.MEDIA_FILE_PREVIEW,
				// width: 512,
				// height: -1, // preserve ratio
			},
		},
		workOptions: {
			...expectation.workOptions,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}

function generateQuantelClipThumbnail(
	expectation: Expectation.QuantelClipCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.QuantelClipThumbnail {
	return literal<Expectation.QuantelClipThumbnail>({
		id: expectation.id + '_thumbnail',
		priority: expectation.priority + 1002,
		managerId: expectation.managerId,
		type: Expectation.Type.QUANTEL_CLIP_THUMBNAIL,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating thumbnail`,
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
				type: Expectation.Version.Type.QUANTEL_CLIP_THUMBNAIL,
				width: 512,
				frame: settings.seekTime || 0, // todo: this is not time, but frames
			},
		},
		workOptions: {
			...expectation.workOptions,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}
function generateQuantelClipPreview(
	expectation: Expectation.QuantelClipCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.QuantelClipPreview {
	return literal<Expectation.QuantelClipPreview>({
		id: expectation.id + '_preview',
		priority: expectation.priority + 1003,
		managerId: expectation.managerId,
		type: Expectation.Type.QUANTEL_CLIP_PREVIEW,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating preview`,
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
				filePath:
					settings.path ||
					expectation.endRequirement.content.guid ||
					expectation.endRequirement.content.title ||
					'',
			},
			version: {
				type: Expectation.Version.Type.QUANTEL_CLIP_PREVIEW,
			},
		},
		workOptions: {
			...expectation.workOptions,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}

function generateJsonDataCopy(
	managerId: string,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.JsonDataCopy {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapJSONData

	const exp: Expectation.JsonDataCopy = {
		id: '', // set later
		priority: expWrap.priority * 10 || 0,
		managerId: managerId,
		fromPackages: [
			{
				id: expWrap.expectedPackage._id,
				expectedContentVersionHash: expWrap.expectedPackage.contentVersionHash,
			},
		],
		type: Expectation.Type.JSON_DATA_COPY,
		statusReport: {
			label: `Copying JSON data`,
			description: `Copy JSON data "${expWrapMediaFile.expectedPackage.content.path}" from "${JSON.stringify(
				expWrapMediaFile.sources
			)}"`,
			requiredForPlayout: true,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement: {
			targets: expWrapMediaFile.targets as [Expectation.SpecificPackageContainerOnPackage.File],
			content: expWrapMediaFile.expectedPackage.content,
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
				...expWrapMediaFile.expectedPackage.version,
			},
		},
		workOptions: {
			removeDelay: settings.delayRemoval,
			useTemporaryFilePath: settings.useTemporaryFilePath,
		},
	}
	exp.id = hashObj(exp.endRequirement)
	return exp
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

export function generatePackageContainerExpectations(
	managerId: string,
	packageContainers: PackageContainers,
	_activePlaylist: ActivePlaylist
): { [id: string]: PackageContainerExpectation } {
	const o: { [id: string]: PackageContainerExpectation } = {}

	for (const [containerId, packageContainer] of Object.entries(packageContainers)) {
		// This is temporary, to test/show how a monitor would work:
		if (containerId === 'source_monitor') {
			o[containerId] = {
				...packageContainer,
				id: containerId,
				managerId: managerId,
				cronjobs: {},
				monitors: {
					packages: {
						targetLayers: ['target0'],
						ignore: '.bat',
						// ignore: '',
					},
				},
			}
		}

		// This is a hard-coded hack for the "smartbull" feature,
		// to be replaced or moved out later:
		if (containerId === 'source-smartbull') {
			o[containerId] = {
				...packageContainer,
				id: containerId,
				managerId: managerId,
				cronjobs: {},
				monitors: {
					packages: {
						targetLayers: ['source-smartbull'], // not used, since the layers of the original smartbull-package are used
						usePolling: 2000,
						awaitWriteFinishStabilityThreshold: 2000,
					},
				},
			}
		}
	}

	return o
}
