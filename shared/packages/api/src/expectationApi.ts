import {
	ExpectedPackageStatusAPI,
	AccessorOnPackage,
	PackageContainerOnPackage,
} from '@sofie-automation/blueprints-integration'

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Expectation {
	export type Any =
		| FileCopy
		| MediaFileScan
		| MediaFileDeepScan
		| MediaFileThumbnail
		| MediaFilePreview
		| QuantelClipCopy

	export enum Type {
		FILE_COPY = 'file_copy',
		MEDIA_FILE_SCAN = 'media_file_scan',
		MEDIA_FILE_DEEP_SCAN = 'media_file_deep_scan',
		MEDIA_FILE_THUMBNAIL = 'media_file_thumbnail',
		MEDIA_FILE_PREVIEW = 'media_file_preview',

		QUANTEL_CLIP_COPY = 'quantel_clip_copy',
	}

	export interface Base {
		id: string
		type: Type

		/** Id of the ExpectationManager the expectation was created from */
		managerId: string

		/** Expectation priority. Lower will be handled first */
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
		workOptions: {}
		/** Reference to another expectation.
		 * Won't start until ALL other expectations are fullfilled
		 */
		dependsOnFullfilled?: string[]
		/** Reference to another expectation.
		 * On fullfillement, this will be triggered immediately.
		 */
		triggerByFullfilledIds?: string[]
	}

	export interface FileCopy extends Base {
		type: Type.FILE_COPY

		startRequirement: {
			sources: PackageContainerOnPackageFile[]
		}
		endRequirement: {
			targets: [PackageContainerOnPackageFile]
			content: {
				filePath: string
			}
			version: Version.ExpectedFileOnDisk
		}
		workOptions: WorkOptions.RemoveDelay
	}
	export interface PackageContainerOnPackageFile extends PackageContainerOnPackage {
		accessors: {
			[accessorId: string]:
				| AccessorOnPackage.LocalFolder
				| AccessorOnPackage.FileShare
				| AccessorOnPackage.HTTP
				| AccessorOnPackage.Quantel
		}
	}

	export interface MediaFileScan extends Base {
		type: Type.MEDIA_FILE_SCAN

		startRequirement: {
			sources: FileCopy['endRequirement']['targets']
			content: FileCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: [PackageContainerOnPackageCorePackage]
			content: {
				filePath: string
			}
			version: null
		}
		workOptions: WorkOptions.RemoveDelay
	}
	export interface MediaFileDeepScan extends Base {
		type: Type.MEDIA_FILE_DEEP_SCAN

		startRequirement: {
			sources: FileCopy['endRequirement']['targets']
			content: FileCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: [PackageContainerOnPackageCorePackage]
			content: {
				filePath: string
			}
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
	export interface PackageContainerOnPackageCorePackage extends PackageContainerOnPackage {
		accessors: {
			[accessorId: string]: AccessorOnPackage.CorePackageCollection
		}
	}
	export interface MediaFileThumbnail extends Base {
		type: Type.MEDIA_FILE_THUMBNAIL

		startRequirement: {
			sources: FileCopy['endRequirement']['targets']
			content: FileCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: PackageContainerOnPackageFile[]
			content: {
				filePath: string
			}
			version: Version.ExpectedMediaFileThumbnail
		}
		workOptions: WorkOptions.RemoveDelay
	}
	export interface MediaFilePreview extends Base {
		type: Type.MEDIA_FILE_PREVIEW

		startRequirement: {
			sources: FileCopy['endRequirement']['targets']
			content: FileCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: PackageContainerOnPackageFile[]
			content: {
				filePath: string
			}
			version: Version.ExpectedMediaFilePreview
		}
		workOptions: WorkOptions.RemoveDelay
	}

	export interface QuantelClipCopy extends Base {
		type: Type.QUANTEL_CLIP_COPY

		startRequirement: {
			sources: PackageContainerOnPackageQuantel[]
		}
		endRequirement: {
			targets: [PackageContainerOnPackageQuantel]
			content: {
				guid?: string
				title?: string
			}
			version: Expectation.Version.ExpectedQuantelClip
		}
	}
	export interface PackageContainerOnPackageQuantel extends PackageContainerOnPackage {
		accessors: {
			[accessorId: string]: AccessorOnPackage.Quantel
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace WorkOptions {
		export interface RemoveDelay {
			/** When removing, wait a duration of time before actually removing it (milliseconds). If not set, package is removed right away. */
			removeDelay?: number
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
		export type Any = FileOnDisk | MediaFileThumbnail | CorePackageInfo | HTTPFile | QuantelClip
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
		}
		type ExpectedType<T extends Base> = Partial<T> & Pick<T, 'type'>
		export type ExpectedFileOnDisk = ExpectedType<FileOnDisk>
		export interface FileOnDisk extends Base {
			type: Type.FILE_ON_DISK
			/** File size in bytes */
			fileSize: number
			modifiedDate: number // timestamp (ms)?: number

			// Not implemented (yet?)
			// checksum?: string
			// checkSumType?: 'sha' | 'md5' | 'whatever'
		}
		export type ExpectedMediaFileThumbnail = ExpectedType<MediaFileThumbnail>
		export interface MediaFileThumbnail extends Base {
			type: Type.MEDIA_FILE_THUMBNAIL
			/** Width of the thumbnail */
			width: number
			/** Heigth of the thumbnail, -1=preserve ratio */
			height: number
			/** At what time to pick the thumbnail from [ms] */
			seekTime: number
		}
		export type ExpectedMediaFilePreview = ExpectedType<MediaFilePreview>
		export interface MediaFilePreview extends Base {
			type: Type.MEDIA_FILE_PREVIEW
			bitrate: string // default: '40k'
			width: number
			height: number
		}
		export type ExpectedCorePackageInfo = ExpectedType<CorePackageInfo>
		export interface CorePackageInfo extends Base {
			type: Type.CORE_PACKAGE_INFO
			actualContentVersionHash: string
		}
		export type ExpectedHTTPFile = ExpectedType<HTTPFile>
		export interface HTTPFile extends Base {
			type: Type.HTTP_FILE
			contentType: string
			contentLength: number
			modified: number
			etags: string[]
		}
		export type ExpectedQuantelClip = ExpectedType<QuantelClip>
		export interface QuantelClip extends Base {
			type: Type.QUANTEL_CLIP

			cloneId: number
			created: string

			frames: number // since this can grow during transfer, don't use it for comparing for fullfillment
		}
	}
}
