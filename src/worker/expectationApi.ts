import {
	ExpectedPackageStatusAPI,
	AccessorOnPackage,
	PackageContainerOnPackage,
} from '@sofie-automation/blueprints-integration'

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Expectation {
	export type Any = MediaFileCopy | MediaFileScan | MediaFileThumbnail | QuantelClipCopy

	export enum Type {
		MEDIA_FILE_COPY = 'media_file_copy',
		MEDIA_FILE_SCAN = 'media_file_scan',
		MEDIA_FILE_THUMBNAIL = 'media_file_thumbnail',

		QUANTEL_COPY = 'quantel_copy',
	}

	export interface Base {
		id: string
		type: Type

		/** A list of which expectedPackages that resultet in this expectation */
		fromPackages: {
			/** ExpectedPackage id */
			id: string
			/** Reference to the contentVersionHash of the ExpectedPackage, used to reference the expected content+version of the Package */
			expectedContentVersionHash: string
		}[]

		/** Contains info for reporting back status to Core */
		statusReport: Omit<ExpectedPackageStatusAPI.WorkBaseInfo, 'fromPackages'>

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
		/** Reference to another expectation.
		 * Won't start until ALL other expectations are fullfilled
		 */
		dependsOnFullfilled?: string[]
		/** Reference to another expectation.
		 * On fullfillement, this will be triggered immediately.
		 */
		triggerByFullfilledIds?: string[]
	}

	export interface MediaFileCopy extends Base {
		type: Type.MEDIA_FILE_COPY

		startRequirement: {
			sources: PackageContainerOnPackageFile[]
		}
		endRequirement: {
			targets: PackageContainerOnPackageFile[]
			content: {
				filePath: string
			}
			version: Version.ExpectedMediaFile
		}
	}
	export interface PackageContainerOnPackageFile extends PackageContainerOnPackage {
		accessors: {
			[accessorId: string]: AccessorOnPackage.LocalFolder | AccessorOnPackage.FileShare | AccessorOnPackage.HTTP
		}
	}

	export interface MediaFileScan extends Base {
		type: Type.MEDIA_FILE_SCAN

		startRequirement: {
			sources: MediaFileCopy['endRequirement']['targets']
			content: MediaFileCopy['endRequirement']['content']
			version: MediaFileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: [PackageContainerOnPackageCorePackage]
			content: {
				filePath: string
			}
			version: null
		}
	}
	export interface PackageContainerOnPackageCorePackage extends PackageContainerOnPackage {
		accessors: {
			[accessorId: string]: AccessorOnPackage.CorePackageCollection
		}
	}
	export interface MediaFileThumbnail extends Base {
		type: Type.MEDIA_FILE_THUMBNAIL

		startRequirement: {
			sources: MediaFileCopy['endRequirement']['targets']
			content: MediaFileCopy['endRequirement']['content']
			version: MediaFileCopy['endRequirement']['version']
		}
		endRequirement: {
			targets: PackageContainerOnPackageFile[]
			content: {
				filePath: string
			}
			version: Version.ExpectedMediaFileThumbnail
		}
	}

	export interface QuantelClipCopy extends Base {
		type: Type.QUANTEL_COPY

		startRequirement: {
			sources: PackageContainerOnPackageQuantel[]
		}
		endRequirement: {
			targets: [PackageContainerOnPackageQuantel]
			content: {
				guid?: string
				title?: string
			}
			version: any // todo
		}
	}
	export interface PackageContainerOnPackageQuantel extends PackageContainerOnPackage {
		accessors: {
			[accessorId: string]: AccessorOnPackage.Quantel
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace Version {
		export type ExpectAny = ExpectedMediaFile | MediaFileThumbnail | ExpectedCorePackageInfo | ExpectedHTTPFile
		export type Any = MediaFile | MediaFileThumbnail | CorePackageInfo | HTTPFile
		export interface Base {
			type: Type
		}
		export enum Type {
			MEDIA_FILE = 'media_file',
			MEDIA_FILE_THUMBNAIL = 'media_file_thumbnail',
			CORE_PACKAGE_INFO = 'core_package_info',
			HTTP_FILE = 'http_file',
		}
		type ExpectedType<T extends Base> = Partial<T> & Pick<T, 'type'>
		export type ExpectedMediaFile = ExpectedType<MediaFile>
		export interface MediaFile extends Base {
			type: Type.MEDIA_FILE
			fileSize: number // in bytes
			modifiedDate: number // timestamp (ms)?: number

			// Not implemented (yet?)
			// checksum?: string
			// checkSumType?: 'sha' | 'md5' | 'whatever'
		}
		export type ExpectedMediaFileThumbnail = ExpectedType<MediaFileThumbnail>
		export interface MediaFileThumbnail extends Base {
			type: Type.MEDIA_FILE_THUMBNAIL
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
	}
}
