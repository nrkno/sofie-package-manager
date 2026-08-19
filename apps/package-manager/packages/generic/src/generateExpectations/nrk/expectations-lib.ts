import * as path from 'path'
import { ExpectedPackageWrap, PackageContainers } from '../../packageManager'
import { PackageManagerSettings } from '../../generated/options'
import {
	Accessor,
	ExpectedPackage,
	PackageContainer,
	Expectation,
	hashObj,
	literal,
	assertNever,
	ExpectationManagerId,
	PackageContainerId,
	protectString,
	ExpectationId,
	AccessorOnPackage,
	AccessorId,
	objectEntries,
} from '@sofie-package-manager/api'
import {
	ExpectedPackageWrapHTMLTemplate,
	ExpectedPackageWrapJSONData,
	ExpectedPackageWrapMediaFile,
	ExpectedPackageWrapQuantel,
	PriorityAdditions,
} from './types'
import { CORE_COLLECTION_ACCESSOR_ID } from './lib'
// eslint-disable-next-line node/no-missing-import
import { MediaRamRecRef, MediaStillRef, protocolEncodeStr, refMediaRamRec, refMediaStill, refToPath } from 'kairos-lib'

type SomeClipCopyExpectation =
	| Expectation.FileCopy
	| Expectation.FileCopyProxy
	| Expectation.FileVerify
	| Expectation.MediaFileConvert
	| Expectation.QuantelClipCopy

type SomeClipFileOnDiskCopyExpectation =
	| Expectation.FileCopy
	| Expectation.FileCopyProxy
	| Expectation.FileVerify
	| Expectation.MediaFileConvert

export function generateMediaFileCopy(
	managerId: ExpectationManagerId,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.FileCopy | Expectation.MediaFileConvert {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

	const endRequirement: Expectation.FileCopy['endRequirement'] = {
		targets: expWrapMediaFile.targets as Expectation.SpecificPackageContainerOnPackage.FileTarget[],
		content: expWrapMediaFile.expectedPackage.content,
		version: {
			type: Expectation.Version.Type.FILE_ON_DISK,
			...expWrapMediaFile.expectedPackage.version,
		},
	}
	const exp: Expectation.FileCopy = {
		id: protectString<ExpectationId>(hashObj(endRequirement)),
		priority: expWrap.priority + PriorityAdditions.COPY,
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
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement: endRequirement,
		workOptions: {
			removeDelay: settings.delayRemoval,
			allowWaitForCPU: false,
			useTemporaryFilePath: settings.useTemporaryFilePath,
			requiredForPlayout: true,
		},
	}

	if (
		expWrapMediaFile.expectedPackage.version.conversions &&
		expWrapMediaFile.expectedPackage.version.conversions.length > 0
	) {
		// Return a MediaFileConvert expectation:

		const convertExp: Expectation.MediaFileConvert = {
			...exp,
			type: Expectation.Type.MEDIA_FILE_CONVERT,
			statusReport: {
				...exp.statusReport,
				label: exp.statusReport.label.replace('Copying media', 'Copy and converting media'),
				description: exp.statusReport.description.replace('Copy media', 'Copy and convert media'),
			},
			startRequirement: {
				sources: expWrapMediaFile.sources,
			},
			endRequirement: {
				targets: endRequirement.targets,
				content: endRequirement.content,
				version: {
					type: Expectation.Version.Type.MEDIA_FILE_CONVERT,
					conversions: expWrapMediaFile.expectedPackage.version.conversions,
				},
			},
			workOptions: exp.workOptions,
		}

		return convertExp
	} else {
		// Just return the copy expectation:
		return exp
	}
}
export function generateMediaFileVerify(
	managerId: ExpectationManagerId,
	expWrap: ExpectedPackageWrap,
	_settings: PackageManagerSettings
): Expectation.FileVerify {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

	const endRequirement: Expectation.FileVerify['endRequirement'] = {
		targets: expWrapMediaFile.targets as Expectation.SpecificPackageContainerOnPackage.FileTarget[],
		content: expWrapMediaFile.expectedPackage.content,
		version: {
			type: Expectation.Version.Type.FILE_ON_DISK,
			...expWrapMediaFile.expectedPackage.version,
		},
	}
	const exp: Expectation.FileVerify = {
		id: protectString<ExpectationId>(hashObj(endRequirement)),
		priority: expWrap.priority + PriorityAdditions.COPY,
		managerId: managerId,
		fromPackages: [
			{
				id: expWrap.expectedPackage._id,
				expectedContentVersionHash: expWrap.expectedPackage.contentVersionHash,
			},
		],
		type: Expectation.Type.FILE_VERIFY,
		statusReport: {
			label: `Check media "${expWrapMediaFile.expectedPackage.content.filePath}"`,
			description: `Check that file "${expWrapMediaFile.expectedPackage.content.filePath}" exists for the device "${expWrapMediaFile.playoutDeviceId}"`,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: [],
		},

		endRequirement,
		workOptions: {
			allowWaitForCPU: false,
			requiredForPlayout: true,
		},
	}

	return exp
}
export function generateQuantelCopy(
	managerId: ExpectationManagerId,
	expWrap: ExpectedPackageWrap
): Expectation.QuantelClipCopy {
	const expWrapQuantelClip = expWrap as ExpectedPackageWrapQuantel

	const content = expWrapQuantelClip.expectedPackage.content

	let guid = content.guid
	const title = content.title

	if (title && guid) {
		if (!guid.match(/^[0-9a-f-]+$/)) {
			// The GUID is on the wrong format, if should only contain hexadecimal characters (and dashes).

			// Discard the guid, and use the title instead, as a last resort:
			guid = undefined
		}
	}

	const label = title && guid ? `${title} (${guid})` : title || guid
	const endRequirement: Expectation.QuantelClipCopy['endRequirement'] = {
		targets: expWrapQuantelClip.targets as [Expectation.SpecificPackageContainerOnPackage.QuantelClip],
		content: content,
		version: {
			type: Expectation.Version.Type.QUANTEL_CLIP,
			...expWrapQuantelClip.expectedPackage.version,
		},
	}
	const exp: Expectation.QuantelClipCopy = {
		id: protectString<ExpectationId>(hashObj(endRequirement)),
		priority: expWrap.priority + PriorityAdditions.COPY,
		managerId: managerId,
		type: Expectation.Type.QUANTEL_CLIP_COPY,
		fromPackages: [
			{
				id: expWrap.expectedPackage._id,
				expectedContentVersionHash: expWrap.expectedPackage.contentVersionHash,
			},
		],

		statusReport: {
			label: `Copy Quantel clip ${label}`,
			description: `Copy Quantel clip ${title || guid} to server for "${
				expWrapQuantelClip.playoutDeviceId
			}", from ${expWrapQuantelClip.sources.map((source) => `"${source.label}"`).join(', ')}`,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapQuantelClip.sources,
		},

		endRequirement,
		workOptions: {
			allowWaitForCPU: false,
			requiredForPlayout: true,
			// removeDelay: 0 // Not used by Quantel
		},
	}

	return exp
}
export function generatePackageScan(
	expectation: SomeClipCopyExpectation,
	settings: PackageManagerSettings
): Expectation.PackageScan {
	let priority = expectation.priority + PriorityAdditions.SCAN

	if ((expectation as any).__isSmartbull) {
		// Because the smartbull is using the scan result in order to build the Sofie rundown, the scan has a high priority:
		priority = expectation.priority + 1
	}

	const useOnlyTargetsAsSources = expectation.type === Expectation.Type.FILE_COPY_PROXY // If previous step is to copy a proxy, we should use only that proxy as source
	return literal<Expectation.PackageScan>({
		id: protectString<ExpectationId>(expectation.id + '_scan'),
		priority: priority,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Scanning`,
			description: `Scanning the media, to provide data to the Sofie GUI`,
			displayRank: 10,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: useOnlyTargetsAsSources
				? [...expectation.endRequirement.targets]
				: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],

			content: expectation.endRequirement.content,
			version:
				expectation.endRequirement.version.type === Expectation.Version.Type.FILE_ON_DISK ||
				expectation.endRequirement.version.type === Expectation.Version.Type.QUANTEL_CLIP
					? expectation.endRequirement.version
					: {
							type: Expectation.Version.Type.FILE_ON_DISK,
					  },
		},
		endRequirement: {
			targets: [
				{
					containerId: protectString<PackageContainerId>('__corePackageInfo'),
					label: 'Core package info',
					accessors: {
						[CORE_COLLECTION_ACCESSOR_ID]: {
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
			requiredForPlayout: !!(expectation as any).__isSmartbull, // For smartbull, the scan result _is_ required for playout
			allowWaitForCPU: false,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFulfilled: useOnlyTargetsAsSources ? [expectation.id] : [],
		triggerByFulfilledIds: [expectation.id],
	})
}
export function generatePackageDeepScan(
	expectation: SomeClipCopyExpectation,
	settings: PackageManagerSettings
): Expectation.PackageDeepScan {
	const useOnlyTargetsAsSources = expectation.type === Expectation.Type.FILE_COPY_PROXY // If previous step is to copy a proxy, we should use only that proxy as source
	return literal<Expectation.PackageDeepScan>({
		id: protectString<ExpectationId>(expectation.id + '_deepscan'),
		priority: expectation.priority + PriorityAdditions.DEEP_SCAN,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_DEEP_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Deep Scanning`,
			description: `Detecting scenes, black frames, freeze frames etc.`,
			displayRank: 13,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: useOnlyTargetsAsSources
				? [...expectation.endRequirement.targets]
				: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
			content: expectation.endRequirement.content,
			version:
				expectation.endRequirement.version.type === Expectation.Version.Type.FILE_ON_DISK ||
				expectation.endRequirement.version.type === Expectation.Version.Type.QUANTEL_CLIP
					? expectation.endRequirement.version
					: {
							type: Expectation.Version.Type.FILE_ON_DISK,
					  },
		},
		endRequirement: {
			targets: [
				{
					containerId: protectString<PackageContainerId>('__corePackageInfo'),
					label: 'Core package info',
					accessors: {
						[CORE_COLLECTION_ACCESSOR_ID]: {
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
			requiredForPlayout: false,
			allowWaitForCPU: true,
			usesCPUCount: 1,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFulfilled: useOnlyTargetsAsSources ? [expectation.id] : [],
		triggerByFulfilledIds: [expectation.id],
	})
}

export function generatePackageLoudness(
	expectation: SomeClipCopyExpectation,
	packageSettings: ExpectedPackage.SideEffectLoudnessSettings,
	settings: PackageManagerSettings
): Expectation.PackageLoudnessScan {
	const useOnlyTargetsAsSources = expectation.type === Expectation.Type.FILE_COPY_PROXY // If previous step is to copy a proxy, we should use only that proxy as source
	return literal<Expectation.PackageLoudnessScan>({
		id: protectString<ExpectationId>(expectation.id + '_loudness'),
		priority: expectation.priority + PriorityAdditions.LOUDNESS_SCAN,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_LOUDNESS_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Loudness Scan`,
			description: `Measure clip loudness, using channels ${packageSettings.channelSpec.join(', ')}`,
			displayRank: 14,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: useOnlyTargetsAsSources
				? [...expectation.endRequirement.targets]
				: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
			content: expectation.endRequirement.content,
			version:
				expectation.endRequirement.version.type === Expectation.Version.Type.FILE_ON_DISK ||
				expectation.endRequirement.version.type === Expectation.Version.Type.QUANTEL_CLIP
					? expectation.endRequirement.version
					: {
							type: Expectation.Version.Type.FILE_ON_DISK,
					  },
		},
		endRequirement: {
			targets: [
				{
					containerId: protectString<PackageContainerId>('__corePackageInfo'),
					label: 'Core package info',
					accessors: {
						[CORE_COLLECTION_ACCESSOR_ID]: {
							type: Accessor.AccessType.CORE_PACKAGE_INFO,
						},
					},
				},
			],
			content: null,
			version: {
				channels: packageSettings.channelSpec,
				balanceDifference: packageSettings.balanceDifference ?? false,
				inPhaseDifference: packageSettings.inPhaseDifference ?? false,
			},
		},
		workOptions: {
			...expectation.workOptions,
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFulfilled: useOnlyTargetsAsSources ? [expectation.id] : [],
		triggerByFulfilledIds: [expectation.id],
	})
}

export function generatePackageIframes(
	expectation: SomeClipCopyExpectation,
	settings: PackageManagerSettings
): Expectation.PackageIframesScan {
	const useOnlyTargetsAsSources = expectation.type === Expectation.Type.FILE_COPY_PROXY // If previous step is to copy a proxy, we should use only that proxy as source
	return {
		id: protectString<ExpectationId>(expectation.id + '_iframes'),
		priority: expectation.priority + PriorityAdditions.IFRAMES_SCAN,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_IFRAMES_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `I-frames Scan`,
			description: `Enumerate I-frames`,
			displayRank: 15,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: useOnlyTargetsAsSources
				? [...expectation.endRequirement.targets]
				: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
			content: expectation.endRequirement.content,
			version:
				expectation.endRequirement.version.type === Expectation.Version.Type.FILE_ON_DISK ||
				expectation.endRequirement.version.type === Expectation.Version.Type.QUANTEL_CLIP
					? expectation.endRequirement.version
					: {
							type: Expectation.Version.Type.FILE_ON_DISK,
					  },
		},
		endRequirement: {
			targets: [
				{
					containerId: protectString<PackageContainerId>('__corePackageInfo'),
					label: 'Core package info',
					accessors: {
						[CORE_COLLECTION_ACCESSOR_ID]: {
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
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFulfilled: useOnlyTargetsAsSources ? [expectation.id] : [],
		triggerByFulfilledIds: [expectation.id],
	}
}
/** Defines a package that should be loaded into RAM on a Kairos Vision mixer */
export function generatePackageKairosLoadToRam(
	packageContainers: PackageContainers,
	expectation: SomeClipCopyExpectation | Expectation.MediaFileConvert,
	packageSettings: ExpectedPackage.SideEffectKairosLoadToRamSettings,
	settings: PackageManagerSettings
): Expectation.PackageKairosLoadToRam | null {
	let filePath: string

	if (expectation.type === Expectation.Type.FILE_COPY) {
		filePath = expectation.endRequirement.content.filePath
	} else if (expectation.type === Expectation.Type.FILE_VERIFY) {
		filePath = expectation.endRequirement.content.filePath
	} else if (expectation.type === Expectation.Type.FILE_COPY_PROXY) {
		filePath = expectation.endRequirement.content.filePath
	} else if (expectation.type === Expectation.Type.MEDIA_FILE_CONVERT) {
		filePath = expectation.endRequirement.content.filePath
	} else {
		return null
	}

	let ref: undefined | MediaRamRecRef | MediaStillRef = undefined

	for (const target of expectation.endRequirement.targets) {
		for (const accessor of Object.values<AccessorOnPackage.Any>(target.accessors)) {
			if (accessor.type === Accessor.AccessType.FTP) {
				const fullPath = path.join(accessor.basePath ?? '', filePath).replace(/\\/g, '/')

				// 'ramrec/Sofie/movie.mp4

				if (fullPath.startsWith('ramrec/')) {
					const localPaths = fullPath
						.replace(/^ramrec\//, '')
						.split('/')
						.map(protocolEncodeStr)

					ref = refMediaRamRec(localPaths)
				} else if (fullPath.startsWith('stills/')) {
					const localPaths = fullPath
						.replace(/^stills\//, '')
						.split('/')
						.map(protocolEncodeStr)

					ref = refMediaStill(localPaths)
				}
			}
		}
	}

	if (!ref) return null

	const packageContainer = packageContainers[packageSettings.containerId]
	if (!packageContainer) return null

	const accessors: { [accessorId: AccessorId]: AccessorOnPackage.KairosClip } = {}
	for (const [accessorId, accessor] of objectEntries(packageContainer.accessors)) {
		if (accessor.type === Accessor.AccessType.KAIROS_CLIP) {
			accessors[accessorId] = accessor
		}
	}

	return {
		id: protectString<ExpectationId>(expectation.id + '_loadToRam'),
		priority: expectation.priority + PriorityAdditions.IFRAMES_SCAN,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_KAIROS_LOAD_TO_RAM,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Load into RAM`,
			description: `Load ${refToPath(ref)} into RAM on KAIROS`,
			displayRank: 15,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: [],
		},
		endRequirement: {
			targets: [
				{
					containerId: packageSettings.containerId,
					label: 'Container for Kairos RAM load',
					accessors,
				},
			],
			content: {
				ref,
			},
			version: null,
		},
		workOptions: {
			...expectation.workOptions,
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFulfilled: [expectation.id],
		triggerByFulfilledIds: [expectation.id],
	}
}

export function generateMediaFileThumbnail(
	expectation: SomeClipFileOnDiskCopyExpectation,
	packageContainerId: PackageContainerId,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.MediaFileThumbnail {
	const useOnlyTargetsAsSources = expectation.type === Expectation.Type.FILE_COPY_PROXY // If previous step is to copy a proxy, we should use only that proxy as source
	return literal<Expectation.MediaFileThumbnail>({
		id: protectString<ExpectationId>(expectation.id + '_thumbnail'),
		priority: expectation.priority + PriorityAdditions.THUMBNAIL,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_THUMBNAIL,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating thumbnail`,
			description: `Thumbnail is used in Sofie GUI`,
			displayRank: 11,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: useOnlyTargetsAsSources
				? [...expectation.endRequirement.targets]
				: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
			content: expectation.endRequirement.content,
			version:
				expectation.endRequirement.version.type === Expectation.Version.Type.FILE_ON_DISK
					? expectation.endRequirement.version
					: {
							type: Expectation.Version.Type.FILE_ON_DISK,
					  },
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
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the thumbnail shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		dependsOnFulfilled: useOnlyTargetsAsSources ? [expectation.id] : [],
		triggerByFulfilledIds: [expectation.id],
	})
}
export function generateMediaFilePreview(
	expectation: SomeClipFileOnDiskCopyExpectation,
	packageContainerId: PackageContainerId,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.MediaFilePreview {
	const useOnlyTargetsAsSources = expectation.type === Expectation.Type.FILE_COPY_PROXY // If previous step is to copy a proxy, we should use only that proxy as source
	return literal<Expectation.MediaFilePreview>({
		id: protectString<ExpectationId>(expectation.id + '_preview'),
		priority: expectation.priority + PriorityAdditions.PREVIEW,
		managerId: expectation.managerId,
		type: Expectation.Type.MEDIA_FILE_PREVIEW,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating preview`,
			description: `Preview is used in Sofie GUI`,
			displayRank: 12,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: useOnlyTargetsAsSources
				? [...expectation.endRequirement.targets]
				: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
			content: expectation.endRequirement.content,
			version:
				expectation.endRequirement.version.type === Expectation.Version.Type.FILE_ON_DISK
					? expectation.endRequirement.version
					: {
							type: Expectation.Version.Type.FILE_ON_DISK,
					  },
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
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the preview shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		dependsOnFulfilled: useOnlyTargetsAsSources ? [expectation.id] : [],
		triggerByFulfilledIds: [expectation.id],
	})
}

export function generateQuantelClipThumbnail(
	expectation: Expectation.QuantelClipCopy,
	packageContainerId: PackageContainerId,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.QuantelClipThumbnail {
	return literal<Expectation.QuantelClipThumbnail>({
		id: protectString<ExpectationId>(expectation.id + '_thumbnail'),
		priority: expectation.priority + PriorityAdditions.THUMBNAIL,
		managerId: expectation.managerId,
		type: Expectation.Type.QUANTEL_CLIP_THUMBNAIL,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating thumbnail`,
			description: `Thumbnail is used in Sofie GUI`,
			displayRank: 11,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
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
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the thumbnail shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		triggerByFulfilledIds: [expectation.id],
	})
}
export function generateQuantelClipPreview(
	expectation: Expectation.QuantelClipCopy,
	packageContainerId: PackageContainerId,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.QuantelClipPreview {
	return literal<Expectation.QuantelClipPreview>({
		id: protectString<ExpectationId>(expectation.id + '_preview'),
		priority: expectation.priority + PriorityAdditions.PREVIEW,
		managerId: expectation.managerId,
		type: Expectation.Type.QUANTEL_CLIP_PREVIEW,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Generating preview`,
			description: `Preview is used in Sofie GUI`,
			displayRank: 12,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
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
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the preview shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		triggerByFulfilledIds: [expectation.id],
	})
}

export function generateJsonDataCopy(
	managerId: ExpectationManagerId,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.JsonDataCopy {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapJSONData

	const endRequirement: Expectation.JsonDataCopy['endRequirement'] = {
		targets: expWrapMediaFile.targets as Expectation.SpecificPackageContainerOnPackage.FileTarget[],
		content: expWrapMediaFile.expectedPackage.content,
		version: {
			type: Expectation.Version.Type.FILE_ON_DISK,
			...expWrapMediaFile.expectedPackage.version,
		},
	}
	const exp: Expectation.JsonDataCopy = {
		id: protectString<ExpectationId>(hashObj(endRequirement)),
		priority: expWrap.priority + PriorityAdditions.COPY,
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
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement,
		workOptions: {
			requiredForPlayout: true,
			removeDelay: settings.delayRemoval,
			useTemporaryFilePath: settings.useTemporaryFilePath,
			allowWaitForCPU: false,
		},
	}
	return exp
}
export function generateHTMLRender(
	managerId: ExpectationManagerId,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.RenderHTML {
	const expWrapHTMLTemplate = expWrap as ExpectedPackageWrapHTMLTemplate

	const expectedPackage = expWrap.expectedPackage as ExpectedPackage.ExpectedPackageHtmlTemplate

	const endRequirement: Expectation.RenderHTML['endRequirement'] = {
		targets: expWrapHTMLTemplate.targets as Expectation.SpecificPackageContainerOnPackage.FileTarget[],
		content: {},
		version: {
			...expectedPackage.version,
		},
	}
	if (
		endRequirement.version.renderer?.width === undefined &&
		endRequirement.version.renderer?.height === undefined &&
		endRequirement.version.renderer?.scale === undefined
	) {
		// Default: Render as thumbnails:
		if (!endRequirement.version.renderer) endRequirement.version.renderer = {}
		endRequirement.version.renderer.width = 1920
		endRequirement.version.renderer.height = 1080
		endRequirement.version.renderer.scale = 1 / 4
	}

	const exp: Expectation.RenderHTML = {
		id: protectString<ExpectationId>(hashObj(endRequirement)),
		priority: expWrap.priority + PriorityAdditions.PREVIEW,
		managerId: managerId,
		fromPackages: [
			{
				id: expWrap.expectedPackage._id,
				expectedContentVersionHash: expWrap.expectedPackage.contentVersionHash,
			},
		],
		type: Expectation.Type.RENDER_HTML,
		statusReport: {
			label: `Rendering HTML template`,
			description: `Rendering HTML template "${expectedPackage.content.path}"`,
			displayRank: 11,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapHTMLTemplate.sources,
			content: {
				path: expectedPackage.content.path,
			},
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
			},
		},

		endRequirement,
		workOptions: {
			allowWaitForCPU: true,
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the thumbnail shouldn't be delayed
			removePackageOnUnFulfill: true,
			useTemporaryFilePath: settings.useTemporaryFilePath,
		},
	}
	return exp
}

export function generatePackageCopyFileProxy(
	expectation: Expectation.FileCopy | Expectation.FileVerify | Expectation.QuantelClipCopy,
	settings: PackageManagerSettings,
	packageContainerId: PackageContainerId,
	packageContainer: PackageContainer
): Expectation.FileCopyProxy | undefined {
	let priority = expectation.priority + PriorityAdditions.COPY_PROXY

	if ((expectation as any).__isSmartbull) {
		// Because the smartbull is using the scan result in order to build the Sofie rundown, the scan has a high priority:
		priority = expectation.priority + 1
	}

	let filePath: string | undefined

	if (expectation.type === Expectation.Type.FILE_COPY) {
		filePath = expectation.endRequirement.content.filePath
	} else if (expectation.type === Expectation.Type.FILE_VERIFY) {
		filePath = expectation.endRequirement.content.filePath
	} else if (expectation.type === Expectation.Type.QUANTEL_CLIP_COPY) {
		filePath = expectation.endRequirement.content.guid || expectation.endRequirement.content.title
	} else {
		assertNever(expectation)
	}
	if (!filePath) return undefined

	return literal<Expectation.FileCopyProxy>({
		id: protectString<ExpectationId>(expectation.id + '_proxy'),
		priority: priority,
		managerId: expectation.managerId,
		type: Expectation.Type.FILE_COPY_PROXY,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Copy proxy`,
			description: `Making a copy as a proxy, used in later steps to scan, generate thumbnail etc..`,
			displayRank: 9,
			sendReport: expectation.statusReport.sendReport,
		},

		startRequirement: {
			sources: [...expectation.endRequirement.targets, ...expectation.startRequirement.sources],
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
				filePath: filePath,
			},
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
			},
		},
		workOptions: {
			...expectation.workOptions,
			requiredForPlayout: !!(expectation as any).__isSmartbull, // For smartbull, this _is_ required for playout
			allowWaitForCPU: false,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFulfilled: [expectation.id],
		triggerByFulfilledIds: [expectation.id],

		originalExpectation: expectation,
	})
}
