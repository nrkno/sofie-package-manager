// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { AccessorOnPackage, PackageContainerOnPackage } from './inputApi'
import { AccessorId, ExpectationId, ExpectationManagerId, ExpectedPackageId } from './ids'

/*
 * This file contains definitions for Expectations, the internal data structure upon which the Package Manager operates.
 */

/** An Expectation defines an "expected end state". The Package Manages takes these as input, then works towards fulfilling the expectations. */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Expectation {
	/** Generic Expectation, used as "Any Expectation" */
	export type Any =
		| FileCopy
		| FileCopyProxy
		| PackageScan
		| PackageDeepScan
		| PackageLoudnessScan
		| PackageIframesScan
		| MediaFileThumbnail
		| MediaFilePreview
		| QuantelClipCopy
		// | QuantelClipScan
		// | QuantelClipDeepScan
		| QuantelClipThumbnail
		| QuantelClipPreview
		| JsonDataCopy
		| FileVerify
		| RenderHTML

	/** Defines the Expectation type, used to separate the different Expectations */
	export enum Type {
		FILE_COPY = 'file_copy',
		FILE_COPY_PROXY = 'file_copy_proxy',
		MEDIA_FILE_THUMBNAIL = 'media_file_thumbnail',
		MEDIA_FILE_PREVIEW = 'media_file_preview',
		FILE_VERIFY = 'file_verify',
		RENDER_HTML = 'render_html',

		PACKAGE_SCAN = 'package_scan',
		PACKAGE_DEEP_SCAN = 'package_deep_scan',
		PACKAGE_LOUDNESS_SCAN = 'package_loudness_scan',
		PACKAGE_IFRAMES_SCAN = 'package_iframes_scan',

		QUANTEL_CLIP_COPY = 'quantel_clip_copy',
		// QUANTEL_CLIP_SCAN = 'quantel_clip_scan',
		// QUANTEL_CLIP_DEEP_SCAN = 'quantel_clip_deep_scan',
		QUANTEL_CLIP_THUMBNAIL = 'quantel_clip_thumbnail',
		QUANTEL_CLIP_PREVIEW = 'quantel_clip_preview',

		JSON_DATA_COPY = 'json_data_copy',
	}

	/** Common attributes of all Expectations */
	export interface Base {
		id: ExpectationId
		type: Type

		/** Id of the ExpectationManager the expectation was created from */
		managerId: ExpectationManagerId

		/** Expectation priority. Lower will be handled first. Note: This is not absolute, the actual execution order might vary. */
		priority: number

		/** A list of which expectedPackages that resulted in this expectation */
		fromPackages: {
			/** ExpectedPackage id */
			id: ExpectedPackageId
			/** Reference to the contentVersionHash of the ExpectedPackage, used to reference the expected content+version of the Package */
			expectedContentVersionHash: string
		}[]

		/** Contains info for reporting back status to Core. null = don't report back */
		statusReport: Omit<ExpectedPackageStatusAPI.WorkBaseInfo, 'fromPackages' | 'requiredForPlayout'> & {
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
		/** Reference to another expectation.
		 * Won't start until ALL other expectations are fulfilled.
		 * If any of the other expectations are not fulfilled, this wont be fulfilled either.
		 */
		dependsOnFulfilled?: ExpectationId[]
		/** Reference to another expectation.
		 * On fulfillment, this will be triggered immediately.
		 */
		triggerByFulfilledIds?: ExpectationId[]
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}
	/** Defines a File Copy, but only to create a Proxy, used for side-effects such as scanning or thumbnail generation */
	export interface FileCopyProxy extends Base {
		type: Type.FILE_COPY_PROXY

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[] | SpecificPackageContainerOnPackage.QuantelClip[]
			content: FileCopy['endRequirement']['content'] | QuantelClipCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version'] | QuantelClipCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				filePath: string
			}
			version: Version.ExpectedFileOnDisk
		}
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath

		originalExpectation: Expectation.FileCopy | Expectation.FileVerify | Expectation.QuantelClipCopy
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay
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
				/** Enable field order detection. An expensive check that decodes the start of the video */
				fieldOrder?: boolean
				/** Number of frames to scan to determine files order. Needs sufficient motion, i.e. beyond title card */
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay
	}
	/** Defines a Loudness Scan of a Media file. A Loudness Scan is to be performed on (one of) the sources and the scan result is to be stored on the target. */
	export interface PackageLoudnessScan extends Base {
		type: Type.PACKAGE_LOUDNESS_SCAN

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[] | SpecificPackageContainerOnPackage.QuantelClip[]
			content: FileCopy['endRequirement']['content'] | QuantelClipCopy['endRequirement']['content']
			version: FileCopy['endRequirement']['version'] | QuantelClipCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.CorePackage[]
			content: null // not using content, entries are stored using this.fromPackages
			version: {
				/** List of channels or stereo channel pairs to be inspected for loudness, 0-indexed. Use channel number as string (e.g. "0") or two numbers with a plus sign for stereo pairs (e.g. "0+1") */
				channels: (`${number}` | `${number}+${number}`)[]

				/** Calculate phase difference between stereo channels in the tracks */
				inPhaseDifference: boolean

				/** Calculate balance difference between stereo channels in the tracks */
				balanceDifference: boolean
			}
		}
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay
	}
	export interface PackageIframesScan extends Base {
		type: Type.PACKAGE_IFRAMES_SCAN

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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
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
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}
	/** Defines a File Copy. A File is to be copied from one of the Sources, to the Target. */
	export interface JsonDataCopy extends Base {
		type: Type.JSON_DATA_COPY

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.FileSource[]
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.JSONDataTarget[]
			content: {
				path?: string
			}
			version: Version.ExpectedJSONData
		}
		workOptions: WorkOptions.Base & WorkOptions.RemoveDelay & WorkOptions.UseTemporaryFilePath
	}

	/** Defines a "Verify File". Doesn't really do any work, just checks that the File exists at the Target. */
	export interface FileVerify extends Base {
		type: Type.FILE_VERIFY

		startRequirement: {
			sources: []
		}
		endRequirement: FileCopy['endRequirement']
	}
	/** Defines a "Verify File". Doesn't really do any work, just checks that the File exists at the Target. */
	export interface RenderHTML extends Base {
		type: Type.RENDER_HTML

		startRequirement: {
			sources: SpecificPackageContainerOnPackage.HTMLFileSource[]
			content: {
				path: string
			}
			version: Version.ExpectedFileOnDisk
		}
		endRequirement: {
			targets: SpecificPackageContainerOnPackage.FileTarget[]
			content: {
				// empty
			}
			version: {
				renderer?: {
					/** Renderer width, defaults to 1920 */
					width?: number
					/** Renderer height, defaults to 1080 */
					height?: number
					/**
					 * Scale the rendered width and height with this value, and also zoom the content accordingly.
					 * For example, if the width is 1920 and scale is 0.5, the width will be scaled to 960.
					 * (Defaults to 1)
					 */
					scale?: number
					/** Background color, #RRGGBB, CSS-string, "transparent" or "default" (defaults to "default") */
					background?: string
					userAgent?: string
				}

				/**
				 * Convenience settings for a template that follows the typical CasparCG steps;
				 * update(data); play(); stop();
				 * If this is set, steps are overridden */
				casparCG?: {
					/**
					 * Data to send into the update() function of a CasparCG Template.
					 * Strings will be piped through as-is, objects will be JSON.stringified.
					 */
					data: { [key: string]: any } | null | string

					/** How long to wait between each action in a CasparCG template, (default: 1000ms) */
					delay?: number
				}

				steps?: (
					| { do: 'waitForLoad' }
					| { do: 'sleep'; duration: number }
					| {
							do: 'sendHTTPCommand'
							url: string
							/** GET, POST, PUT etc.. */
							method: string
							body?: ArrayBuffer | ArrayBufferView | NodeJS.ReadableStream | string | URLSearchParams

							headers?: Record<string, string>
					  }
					| { do: 'takeScreenshot'; fileName: string }
					| { do: 'startRecording'; fileName: string }
					| { do: 'stopRecording' }
					| { do: 'cropRecording'; fileName: string }
					| { do: 'executeJs'; js: string }
					// Store an object in memory
					| {
							do: 'storeObject'
							key: string
							/** The value to store into memory. Either an object, or a JSON-stringified object */
							value: Record<string, any> | string
					  }
					// Modify an object in memory. Path is a dot-separated string
					| { do: 'modifyObject'; key: string; path: string; value: any }
					// Send an object to the renderer as a postMessage (so basically does a executeJs: window.postMessage(memory[key]))
					| {
							do: 'injectObject'
							key: string
							/** The method to receive the value. Defaults to window.postMessage */
							receivingFunction?: string
					  }
				)[]
			}
		}
	}

	/** Contains definitions of specific PackageContainer types, used in the Expectation-definitions */
	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace SpecificPackageContainerOnPackage {
		/** Defines a PackageContainer for "Files" (ie the stuff stored on a hard drive or equivalent). Contains the various accessors that support reading files. */
		export interface FileSource extends PackageContainerOnPackage {
			accessors: {
				[accessorId: AccessorId]:
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
				[accessorId: AccessorId]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTPProxy
			}
		}
		/** Defines a PackageContainer for CorePackage (A collection in Sofie-Core accessible through an API). */
		export interface CorePackage extends PackageContainerOnPackage {
			accessors: {
				[accessorId: AccessorId]: AccessorOnPackage.CorePackageCollection
			}
		}
		/** Defines a PackageContainer for Quantel clips, stored on Quantel servers. */
		export interface QuantelClip extends PackageContainerOnPackage {
			accessors: {
				[accessorId: AccessorId]: AccessorOnPackage.Quantel
			}
		}

		/** Defines a PackageContainer for reading JSON data. */
		export interface JSONDataSource extends PackageContainerOnPackage {
			accessors: {
				[accessorId: string]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTP
					| AccessorOnPackage.HTTPProxy
			}
		}

		/** Defines a PackageContainer for writing JSON data. */
		export interface JSONDataTarget extends PackageContainerOnPackage {
			accessors: {
				[accessorId: string]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTPProxy
					| AccessorOnPackage.CorePackageCollection
			}
		}

		/** Defines a PackageContainer for reading a HTML file. */
		export interface HTMLFileSource extends PackageContainerOnPackage {
			accessors: {
				[accessorId: string]:
					| AccessorOnPackage.LocalFolder
					| AccessorOnPackage.FileShare
					| AccessorOnPackage.HTTP
					| AccessorOnPackage.HTTPProxy
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace WorkOptions {
		export interface Base {
			/** If set, a worker might decide to wait with this expectation until the CPU load is lower. */
			allowWaitForCPU?: boolean
			/** If set, specifies how many CPU cores the work is using. */
			usesCPUCount?: number
			/** If set, removes the target package if the expectation becomes unfulfilled. */
			removePackageOnUnFulfill?: boolean
			/** If set, the expectation is required for playout and therefore has the highest priority */
			requiredForPlayout?: boolean
		}
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
			| ExpectedJSONData
		export type Any =
			| FileOnDisk
			| MediaFileThumbnail
			| CorePackageInfo
			| HTTPFile
			| QuantelClip
			| ATEMFile
			| JSONData
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
			JSON_DATA = 'json_data',
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
			/** Height of the thumbnail, -1=preserve ratio */
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

			frames: number // since this can grow during transfer, don't use it for comparing for fulfillment
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

		export interface JSONData extends Base {
			type: Type.JSON_DATA
			/** size in bytes */
			size: string
		}
		export type ExpectedJSONData = ExpectedType<JSONData>
	}
}
