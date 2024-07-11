import { ExpectedPackageWrap } from '../../packageManager'
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
} from '@sofie-package-manager/api'
import {
	ExpectedPackageWrapHTMLTemplate,
	ExpectedPackageWrapJSONData,
	ExpectedPackageWrapMediaFile,
	ExpectedPackageWrapQuantel,
	PriorityAdditions,
} from './types'
import { CORE_COLLECTION_ACCESSOR_ID } from './lib'

type SomeClipCopyExpectation =
	| Expectation.FileCopy
	| Expectation.FileCopyProxy
	| Expectation.FileVerify
	| Expectation.QuantelClipCopy

type SomeClipFileOnDiskCopyExpectation = Expectation.FileCopy | Expectation.FileCopyProxy | Expectation.FileVerify

export function generateMediaFileCopy(
	managerId: ExpectationManagerId,
	expWrap: ExpectedPackageWrap,
	settings: PackageManagerSettings
): Expectation.FileCopy {
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

	return exp
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
			sources: expectation.endRequirement.targets,
			content: expectation.endRequirement.content,
			version: expectation.endRequirement.version,
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
		dependsOnFulfilled: [expectation.id],
		triggerByFulfilledIds: [expectation.id],
	})
}
export function generatePackageDeepScan(
	expectation: SomeClipCopyExpectation,
	settings: PackageManagerSettings
): Expectation.PackageDeepScan {
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
			sources: expectation.endRequirement.targets,
			content: expectation.endRequirement.content,
			version: expectation.endRequirement.version,
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
		dependsOnFulfilled: [expectation.id],
		triggerByFulfilledIds: [expectation.id],
	})
}

export function generatePackageLoudness(
	expectation: SomeClipCopyExpectation,
	packageSettings: ExpectedPackage.SideEffectLoudnessSettings,
	settings: PackageManagerSettings
): Expectation.PackageLoudnessScan {
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
			sources: expectation.endRequirement.targets,
			content: expectation.endRequirement.content,
			version: expectation.endRequirement.version,
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
		dependsOnFulfilled: [expectation.id],
		triggerByFulfilledIds: [expectation.id],
	})
}

export function generateMediaFileThumbnail(
	expectation: SomeClipFileOnDiskCopyExpectation,
	packageContainerId: PackageContainerId,
	settings: ExpectedPackage.SideEffectThumbnailSettings,
	packageContainer: PackageContainer
): Expectation.MediaFileThumbnail {
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
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the thumbnail shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		dependsOnFulfilled: [expectation.id],
		triggerByFulfilledIds: [expectation.id],
	})
}
export function generateMediaFilePreview(
	expectation: SomeClipFileOnDiskCopyExpectation,
	packageContainerId: PackageContainerId,
	settings: ExpectedPackage.SideEffectPreviewSettings,
	packageContainer: PackageContainer
): Expectation.MediaFilePreview {
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
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the preview shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		dependsOnFulfilled: [expectation.id],
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
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the thumbnail shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		dependsOnFulfilled: [expectation.id],
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
			requiredForPlayout: false,
			usesCPUCount: 1,
			removeDelay: 0, // The removal of the preview shouldn't be delayed
			removePackageOnUnFulfill: true,
		},
		dependsOnFulfilled: [expectation.id],
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
		content: {
			prefix: expectedPackage.content.outputPrefix,
		},
		version: {
			...expWrapHTMLTemplate.expectedPackage.version,
		},
	}
	if (
		endRequirement.version.renderer?.width === undefined &&
		endRequirement.version.renderer?.height === undefined &&
		endRequirement.version.renderer?.zoom === undefined
	) {
		// Default: Render as thumbnails:
		if (!endRequirement.version.renderer) endRequirement.version.renderer = {}
		endRequirement.version.renderer.width = 1920 / 4
		endRequirement.version.renderer.height = 1080 / 4
		endRequirement.version.renderer.zoom = 1 / 4
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
			description: `Rendering HTML template "${expWrapHTMLTemplate.expectedPackage.content.path}"`,
			displayRank: 11,
			sendReport: !expWrap.external,
		},

		startRequirement: {
			sources: expWrapHTMLTemplate.sources,
			content: expWrapHTMLTemplate.expectedPackage.content,
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
			requiredForPlayout: !!(expectation as any).__isSmartbull, // For smartbull, this _is_ required for playout
			allowWaitForCPU: false,
			removeDelay: settings.delayRemovalPackageInfo,
		},
		dependsOnFulfilled: [expectation.id],
		triggerByFulfilledIds: [expectation.id],

		originalExpectation: expectation,
	})
}
