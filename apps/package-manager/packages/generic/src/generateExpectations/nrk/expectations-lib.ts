import { ExpectedPackageWrap, PackageManagerSettings } from '../../packageManager'
import {
	Accessor,
	ExpectedPackage,
	PackageContainer,
	Expectation,
	hashObj,
	literal,
	assertNever,
} from '@sofie-package-manager/api'
import {
	ExpectedPackageWrapJSONData,
	ExpectedPackageWrapMediaFile,
	ExpectedPackageWrapQuantel,
	PriorityAdditions,
} from './types'

export function generateMediaFileCopy(
	managerId: string,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.FileCopy {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

	const exp: Expectation.FileCopy = {
		id: '', // set later
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
			requiredForPlayout: true,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement: {
			targets: expWrapMediaFile.targets as Expectation.SpecificPackageContainerOnPackage.FileTarget[],
			content: expWrapMediaFile.expectedPackage.content,
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
				...expWrapMediaFile.expectedPackage.version,
			},
		},
		workOptions: {
			removeDelay: settings.delayRemoval,
			allowWaitForCPU: false,
			useTemporaryFilePath: settings.useTemporaryFilePath,
		},
	}
	exp.id = hashObj(exp.endRequirement)
	return exp
}
export function generateMediaFileVerify(
	managerId: string,
	expWrap: ExpectedPackageWrap,
	_settings: PackageManagerSettings
): Expectation.FileVerify {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

	const exp: Expectation.FileVerify = {
		id: '', // set later
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
			requiredForPlayout: true,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: [],
		},

		endRequirement: {
			targets: expWrapMediaFile.targets as Expectation.SpecificPackageContainerOnPackage.FileTarget[],
			content: expWrapMediaFile.expectedPackage.content,
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
				...expWrapMediaFile.expectedPackage.version,
			},
		},
		workOptions: {
			allowWaitForCPU: false,
		},
	}
	exp.id = hashObj(exp.endRequirement)
	return exp
}
export function generateQuantelCopy(managerId: string, expWrap: ExpectedPackageWrap): Expectation.QuantelClipCopy {
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
	const exp: Expectation.QuantelClipCopy = {
		id: '', // set later
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
			allowWaitForCPU: false,
			// removeDelay: 0 // Not used by Quantel
		},
	}
	exp.id = hashObj(exp.endRequirement)

	return exp
}
export function generatePackageScan(
	expectation:
		| Expectation.FileCopy
		| Expectation.FileCopyProxy
		| Expectation.FileVerify
		| Expectation.QuantelClipCopy,
	settings: PackageManagerSettings
): Expectation.PackageScan {
	let priority = expectation.priority + PriorityAdditions.SCAN

	if ((expectation as any).__isSmartbull) {
		// Because the smartbull is using the scan result in order to build the Sofie rundown, the scan has a high priority:
		priority = expectation.priority + 1
	}

	return literal<Expectation.PackageScan>({
		id: expectation.id + '_scan',
		priority: priority,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Scanning`,
			description: `Scanning the media, to provide data to the Sofie GUI`,
			requiredForPlayout: !!(expectation as any).__isSmartbull, // For smartbull, the scan result _is_ required for playout
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
			allowWaitForCPU: false,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}
export function generatePackageDeepScan(
	expectation:
		| Expectation.FileCopy
		| Expectation.FileCopyProxy
		| Expectation.FileVerify
		| Expectation.QuantelClipCopy,
	settings: PackageManagerSettings
): Expectation.PackageDeepScan {
	return literal<Expectation.PackageDeepScan>({
		id: expectation.id + '_deepscan',
		priority: expectation.priority + PriorityAdditions.DEEP_SCAN,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_DEEP_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Deep Scanning`,
			description: `Detecting scenes, black frames, freeze frames etc.`,
			requiredForPlayout: false,
			displayRank: 13,
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
			allowWaitForCPU: true,
			usesCPUCount: 1,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}

export function generatePackageLoudness(
	expectation:
		| Expectation.FileCopy
		| Expectation.FileCopyProxy
		| Expectation.FileVerify
		| Expectation.QuantelClipCopy,
	packageSettings: ExpectedPackage.SideEffectLoudnessSettings,
	settings: PackageManagerSettings
): Expectation.PackageLoudnessScan {
	return literal<Expectation.PackageLoudnessScan>({
		id: expectation.id + '_loudness',
		priority: expectation.priority + PriorityAdditions.LOUDNESS_SCAN,
		managerId: expectation.managerId,
		type: Expectation.Type.PACKAGE_LOUDNESS_SCAN,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Loudness Scan`,
			description: `Measure clip loudness`,
			requiredForPlayout: false,
			displayRank: 14,
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
				channels: packageSettings.channelSpec,
			},
		},
		workOptions: {
			...expectation.workOptions,
			allowWaitForCPU: true,
			usesCPUCount: 1,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}

export function generateMediaFileThumbnail(
	expectation: Expectation.FileCopy | Expectation.FileCopyProxy | Expectation.FileVerify,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.MediaFileThumbnail {
	return literal<Expectation.MediaFileThumbnail>({
		id: expectation.id + '_thumbnail',
		priority: expectation.priority + PriorityAdditions.THUMBNAIL,
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
			allowWaitForCPU: true,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}
export function generateMediaFilePreview(
	expectation: Expectation.FileCopy | Expectation.FileCopyProxy | Expectation.FileVerify,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.MediaFilePreview {
	return literal<Expectation.MediaFilePreview>({
		id: expectation.id + '_preview',
		priority: expectation.priority + PriorityAdditions.PREVIEW,
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
			allowWaitForCPU: true,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}

export function generateQuantelClipThumbnail(
	expectation: Expectation.QuantelClipCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.QuantelClipThumbnail {
	return literal<Expectation.QuantelClipThumbnail>({
		id: expectation.id + '_thumbnail',
		priority: expectation.priority + PriorityAdditions.THUMBNAIL,
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
			allowWaitForCPU: true,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}
export function generateQuantelClipPreview(
	expectation: Expectation.QuantelClipCopy,
	packageContainerId: string,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.QuantelClipPreview {
	return literal<Expectation.QuantelClipPreview>({
		id: expectation.id + '_preview',
		priority: expectation.priority + PriorityAdditions.PREVIEW,
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
			allowWaitForCPU: true,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the scan itself shouldn't be delayed
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],
	})
}

export function generateJsonDataCopy(
	managerId: string,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.JsonDataCopy {
	const expWrapMediaFile = expWrap as ExpectedPackageWrapJSONData

	const exp: Expectation.JsonDataCopy = {
		id: '', // set later
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
			requiredForPlayout: true,
			displayRank: 0,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapMediaFile.sources,
		},

		endRequirement: {
			targets: expWrapMediaFile.targets as Expectation.SpecificPackageContainerOnPackage.FileTarget[],
			content: expWrapMediaFile.expectedPackage.content,
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
				...expWrapMediaFile.expectedPackage.version,
			},
		},
		workOptions: {
			removeDelay: settings.delayRemoval,
			useTemporaryFilePath: settings.useTemporaryFilePath,
			allowWaitForCPU: false,
		},
	}
	exp.id = hashObj(exp.endRequirement)
	return exp
}

export function generatePackageCopyFileProxy(
	expectation: Expectation.FileCopy | Expectation.FileVerify | Expectation.QuantelClipCopy,
	settings: PackageManagerSettings,
	packageContainerId: string,
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
		id: expectation.id + '_proxy',
		priority: priority,
		managerId: expectation.managerId,
		type: Expectation.Type.FILE_COPY_PROXY,
		fromPackages: expectation.fromPackages,

		statusReport: {
			label: `Copy proxy`,
			description: `Making a copy as a proxy, used in later steps to scan, generate thumbnail etc..`,
			requiredForPlayout: !!(expectation as any).__isSmartbull, // For smartbull, this _is_ required for playout
			displayRank: 9,
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
				filePath: filePath,
			},
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
			},
		},
		workOptions: {
			...expectation.workOptions,
			allowWaitForCPU: false,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFullfilled: [expectation.id],
		triggerByFullfilledIds: [expectation.id],

		originalExpectation: expectation,
	})
}
