import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { AccessorOnPackage, PackageContainerOnPackage } from './inputApi'

/*
 * This file contains definitions for Expectations, the internal datastructure upon which the Package Manager operates.
 */

/** An Expectation defines an "expected end state". The Package Manages takes these as input, then works towards fullfilling the expectations. */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Expectation {
	/** Generic Expectation, used as "Any Exopectation" */
	export type Any =
		| FileCopy
		| PackageScan
		| PackageDeepScan
		| MediaFileThumbnail
		| MediaFilePreview
		| QuantelClipCopy
		// | QuantelClipScan
		// | QuantelClipDeepScan
		| QuantelClipThumbnail
		| QuantelClipPreview
		| JsonDataCopy
		| FileVerify

	/** Defines the Expectation type, used to separate the different Expectations */
	export enum Type {
		FILE_COPY = 'file_copy',
		MEDIA_FILE_THUMBNAIL = 'media_file_thumbnail',
		MEDIA_FILE_PREVIEW = 'media_file_preview',
		FILE_VERIFY = 'file_verify',

		PACKAGE_SCAN = 'package_scan',
		PACKAGE_DEEP_SCAN = 'package_deep_scan',

		QUANTEL_CLIP_COPY = 'quantel_clip_copy',
		// QUANTEL_CLIP_SCAN = 'quantel_clip_scan',
		// QUANTEL_CLIP_DEEP_SCAN = 'quantel_clip_deep_scan',
		QUANTEL_CLIP_THUMBNAIL = 'quantel_clip_thumbnail',
		QUANTEL_CLIP_PREVIEW = 'quantel_clip_preview',

		JSON_DATA_COPY = 'json_data_copy',
	}

	/** Common attributes of all Expectations */
	export interface Base {
		id: string
		type: Type

		/** Id of the ExpectationManager the expectation was created from */
		managerId: string

		/** Expectation priority. Lower will be handled first. Note: This is not absolute, the actual execution order might vary. */
		priority: number

		/** A list of which expectedPackages that resultet in this expectation */
		fromPackages: {
			/** ExpectedPackage id */
			id: string
			/** Reference to the contentVersionHash of the ExpectedPackage, used to reference the expected content+version of the Package */
			expectedContentVersionHash: string
		}[]

		/** Contains info for reporting back status to Core. null = don't report back */
		statusReport: Omit<ExpectedPackageStatusAPI.WorkBaseInfo, 'fromPackages'> & {
			/** Set to true to enable reporting back statuses to Core */
			sendReport: boolean
		}

		/** Contains info for determining that work can start (and is used to perform the work) */
		startRequirement: {
			sources: PackageContainerOnPackage[]
		}
		/** Contains info for determining that work can end (and is used to perform the work) */
		endRequirement: {
			targets: PackageContainerOnPackage[]
			content: any
			version: any
		}
		/** Contains info that can be used during work on an expectation. Changes in this does NOT cause an invalidation of the expectation. */
		workOptions: any // {}
		/** Reference to another expectation.
		 * Won't start until ALL other expectations are fullfilled
		 */
		dependsOnFullfilled?: string[]
		/** Reference to another expectation.
		 * On fullfillement, this will be triggered immediately.
		 */
		triggerByFullfilledIds?: string[]
	}

	/** Defines a File Copy. A File is to be copied from one of the Sources, to the Target. */
	export interface FileCopy extends Base {
		type: Type.FILE_COPY

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[]
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				filePath: string
			}
			version: Version.ExpectedFileOnDisk
		}
		workOptions: WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}
	/** Defines a Scan of a Media file. A Scan is to be performed on (one of) the sources and the scan result is to be stored on the target. */
	export interface PackageScan extends Base {
		type: Type.PACKAGE_SCAN

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[] | SpecificPackageContainerOnPackage.QuantelClip[]
			content: FileCopy['endRequirement']['content'] | QuantelClipCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version'] | QuantelClipCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.CorePackage[]
			content: null // not using content, entries are stored using this.fromPackages
			version: null
		}
		workOptions: WorkOptions.RemoveDelay
	}
	/** Defines a Deep-Scan of a Media file. A Deep-Scan is to be performed on (one of) the sources and the scan result is to be stored on the target. */
	export interface PackageDeepScan extends Base {
		type: Type.PACKAGE_DEEP_SCAN

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[] | SpecificPackageContainerOnPackage.QuantelClip[]
			content: FileCopy['endRequirement']['content'] | QuantelClipCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version'] | QuantelClipCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.CorePackage[]
			content: null // not using content, entries are stored using this.fromPackages
			version: {
				/** Enable field order detection. An expensive chcek that decodes the start of the video */
				fieldOrder?: boolean
				/** Number of frames to scan to determine files order. Neede sufficient motion, i.e. beyong title card */
				fieldOrderScanDuration?: number

				/** Enable scene change detection */
				scenes?: boolean
				/** Likelihood frame introduces new scene (`0.0` to `1.0`). Defaults to `0.4` */
				sceneThreshold?: number

				/** Enable freeze frame detection */
				freezeDetection?: boolean
				/** Noise tolerance - difference ratio between `0.0` to `1.0`. Default is `0.001` */
				freezeNoise?: number
				/** Duration of freeze before notification. Default is `2s` */
				freezeDuration?: string

				/** Enable black frame detection */
				blackDetection?: boolean
				/** Duration of black until notified. Default `2.0` */
				blackDuration?: string
				/** Ratio of black pixels per frame before frame is black. Value between `0.0` and `1.0` defaulting to `0.98` */
				blackRatio?: number
				/** Luminance threshold for a single pixel to be considered black. Default is `0.1` */
				blackThreshold?: number
			}
		}
		workOptions: WorkOptions.RemoveDelay
	}
	/** Defines a Thumbnail of a Media file. A Thumbnail is to be created from one of the the sources and the resulting file is to be stored on the target. */
	export interface MediaFileThumbnail extends Base {
		type: Type.MEDIA_FILE_THUMBNAIL

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[]
			content: FileCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				filePath: string
			}
			version: Version.ExpectedMediaFileThumbnail
		}
		workOptions: WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}
	/** Defines a Preview of a Media file. A Preview is to be created from one of the the sources and the resulting file is to be stored on the target. */
	export interface MediaFilePreview extends Base {
		type: Type.MEDIA_FILE_PREVIEW

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[]
			content: FileCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				filePath: string
			}
			version: Version.ExpectedMediaFilePreview
		}
		workOptions: WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}

	/** Defines a Quantel clip. A Quantel clip is to be copied from one of the Sources, to the Target. */
	export interface QuantelClipCopy extends Base {
		type: Type.QUANTEL_CLIP_COPY

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.QuantelClip[]
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.QuantelClip[]
			content: {
				guid?: string
				title?: string
			}
			version: Expectation.Version.ExpectedQuantelClip
		}
	}

	/** Defines a Thumbnail of a Media file. A Thumbnail is to be created from one of the the sources and the resulting file is to be stored on the target. */
	export interface QuantelClipThumbnail extends Base {
		type: Type.QUANTEL_CLIP_THUMBNAIL

		startRequirement: {
			sources: QuantelClipCopy['endRequirement']['targets']
			content: QuantelClipCopy['endRequirement']['content']
			version: QuantelClipCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				filePath: string
			}
			version: Version.ExpectedQuantelClipThumbnail
		}
		workOptions: WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}
	/** Defines a Preview of a Quantel Clip. A Preview is to be created from one of the the sources and the resulting file is to be stored on the target. */
	export interface QuantelClipPreview extends Base {
		type: Type.QUANTEL_CLIP_PREVIEW

		startRequirement: {
			sources: QuantelClipCopy['endRequirement']['targets']
			content: QuantelClipCopy['endRequirement']['content']
			version: QuantelClipCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				filePath: string
			}
			version: Version.ExpectedQuantelClipPreview
		}
		workOptions: WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}
	/** Defines a File Copy. A File is to be copied from one of the Sources, to the Target. */
	export interface JsonDataCopy extends Base {
		type: Type.JSON_DATA_COPY

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[]
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				path: string
			}
			version: Version.ExpectedFileOnDisk // maybe something else?
		}
		workOptions: WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}

	/** Defines a "Verify File". Doesn't really do any work, just checks that the File exists at the Target. */
	export interface FileVerify extends Base {
		type: Type.FILE_VERIFY

		startRequirement: {
			sources: []
		}
		endRequirement: FileCopy['endRequirement']
	}

	/** Contains definitions of specific PackageContainer types, used in the Expectation-definitions */
	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace SpecificPackageContainerOnPackage {
		/** Defines a PackageContainer for "Files" (ie the stuff stored on a hard drive or equivalent). Contains the various accessors that support reading files. */
		export interface FileSource extends PackageContainerOnPackage {
			accessors: {
				[accessorId: string]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTP
					| AccessorOnPackage.HTTPProxy
					| AccessorOnPackage.Quantel
			}
		}
		/** Defines a PackageContainer for "Files" (ie the stuff stored on a hard drive or equivalent). Contains the various accessors that support writing files. */
		export interface FileTarget extends PackageContainerOnPackage {
			accessors: {
				[accessorId: string]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTPProxy
			}
		}
		/** Defines a PackageContainer for CorePackage (A collection in Sofie-Core accessible through an API). */
		export interface CorePackage extends PackageContainerOnPackage {
			accessors: {
				[accessorId: string]: AccessorOnPackage.CorePackageCollection
			}
		}
		/** Defines a PackageContainer for Quantel clips, stored on Quantel servers. */
		export interface QuantelClip extends PackageContainerOnPackage {
			accessors: {
				[accessorId: string]: AccessorOnPackage.Quantel
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace WorkOptions {
		export interface RemoveDelay {
			/** When removing, wait a duration of time before actually removing it (milliseconds). If not set, package is removed right away. */
			removeDelay?: number
		}
		export interface UseTemporaryFilePath {
			/** When set, will work on a temporary package first, then move the package to the right place */
			useTemporaryFilePath?: boolean
		}
	}

	/** Version defines properties to use for determining the version of a Package */
	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace Version {
		export type ExpectAny =
			| ExpectedFileOnDisk
			| MediaFileThumbnail
			| ExpectedCorePackageInfo
			| ExpectedHTTPFile
			| ExpectedQuantelClip
			| ExpectedATEMFile
		export type Any = FileOnDisk | MediaFileThumbnail | CorePackageInfo | HTTPFile | QuantelClip | ATEMFile
		export interface Base {
			type: Type
		}
		export enum Type {
			FILE_ON_DISK = 'file_on_disk',
			MEDIA_FILE_THUMBNAIL = 'media_file_thumbnail',
			MEDIA_FILE_PREVIEW = 'media_file_preview',
			CORE_PACKAGE_INFO = 'core_package_info',
			HTTP_FILE = 'http_file',
			QUANTEL_CLIP = 'quantel_clip',
			QUANTEL_CLIP_THUMBNAIL = 'quantel_clip_thumbnail',
			QUANTEL_CLIP_PREVIEW = 'quantel_clip_preview',
			ATEM_FILE = 'atem_file',
		}
		type ExpectedType<T extends Base> = Partial<T> & Pick<T, 'type'>

		export interface FileOnDisk extends Base {
			type: Type.FILE_ON_DISK
			/** File size in bytes */
			fileSize: number
			modifiedDate: number // timestamp (ms)?: number

			// Not implemented (yet?)
			// checksum?: string
			// checkSumType?: 'sha' | 'md5' | 'whatever'
		}
		export type ExpectedFileOnDisk = ExpectedType<FileOnDisk>

		export interface MediaFileThumbnail extends Base {
			type: Type.MEDIA_FILE_THUMBNAIL
			/** Width of the thumbnail */
			width: number
			/** Heigth of the thumbnail, -1=preserve ratio */
			height: number
			/** At what time to pick the thumbnail from [ms] */
			seekTime: number
		}
		export type ExpectedMediaFileThumbnail = ExpectedType<MediaFileThumbnail>

		export interface MediaFilePreview extends Base {
			type: Type.MEDIA_FILE_PREVIEW
			bitrate: string // default: '40k'
			width: number
			height: number
		}
		export type ExpectedMediaFilePreview = ExpectedType<MediaFilePreview>

		export interface CorePackageInfo extends Base {
			type: Type.CORE_PACKAGE_INFO
			actualContentVersionHash: string
		}
		export type ExpectedCorePackageInfo = ExpectedType<CorePackageInfo>

		export interface HTTPFile extends Base {
			type: Type.HTTP_FILE
			contentType: string
			contentLength: number
			modified: number
			etags: string[]
		}
		export type ExpectedHTTPFile = ExpectedType<HTTPFile>

		export interface QuantelClip extends Base {
			type: Type.QUANTEL_CLIP

			cloneId: number
			created: string

			frames: number // since this can grow during transfer, don't use it for comparing for fullfillment
		}
		export type ExpectedQuantelClip = ExpectedType<QuantelClip>

		export interface QuantelClipThumbnail extends Base {
			type: Type.QUANTEL_CLIP_THUMBNAIL
			/** Width of the thumbnail */
			width: number

			/** At what frame to pick the thumbnail from. If between 0 and 1, will be treated as % of the source duration. */
			frame: number
		}
		export type ExpectedQuantelClipThumbnail = ExpectedType<QuantelClipThumbnail>

		export interface QuantelClipPreview extends Base {
			type: Type.QUANTEL_CLIP_PREVIEW
			bitrate: string // default: '40k'
			width: number
			height: number
		}
		export type ExpectedQuantelClipPreview = ExpectedType<QuantelClipPreview>

		export interface ATEMFile extends Base {
			type: Type.ATEM_FILE
			frameCount: number
			name: string
			hash: string
		}
		export type ExpectedATEMFile = ExpectedType<ATEMFile>
	}
}
