import { PackageLocation, PackageOriginOnPackage } from '@sofie-automation/blueprints-integration'

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Expectation {
	export type Any = MediaFileCopy | MediaFileScan | QuantelClipCopy

	export enum Type {
		MEDIA_FILE_COPY = 'media_file_copy',
		MEDIA_FILE_SCAN = 'media_file_scan',

		QUANTEL_COPY = 'quantel_copy',
	}

	export interface Base {
		id: string
		type: Type

		/** Contains info for determining that work can start (and is used to perform the work) */
		startRequirement: any
		/** Contains info for determining that work can end (and is used to perform the work) */
		endRequirement: {
			location: undefined | PackageLocation.Any
			content: any
			version: any
		}
		/** Reference to another expectation.
		 * On fullfillement, this will be triggered immediately.
		 */
		triggerByFullfilledIds?: string[]
	}

	export interface MediaFileCopy extends Base {
		type: Type.MEDIA_FILE_COPY
		label: string

		startRequirement: {
			origins: (
				| PackageOriginOnPackage.LocalFolder
				| PackageOriginOnPackage.FileShare
				| PackageOriginOnPackage.MappedDrive
				| PackageOriginOnPackage.HTTP
			)[]
		}
		endRequirement: {
			location: PackageLocation.LocalFolder // | PackageLocation.FileShare | PackageLocation.HTTP | PackageLocation.MappedDrive
			content: {
				filePath: string
			}
			version: MediaFileVersion
		}
	}
	export interface MediaFileVersion {
		fileSize?: number // in bytes
		modifiedDate?: number // timestamp (ms)?: number
		checksum?: string
		checkSumType?: 'sha' | 'md5' | 'whatever'
	}
	export interface MediaFileScan extends Base {
		type: Type.MEDIA_FILE_SCAN
		label: string

		startRequirement: MediaFileCopy['endRequirement']
		endRequirement: {
			location: PackageLocation.CorePackageCollection
			content: {
				filePath: string
			}
			version: MediaFileVersion
		}
	}

	export interface QuantelClipCopy extends Base {
		type: Type.QUANTEL_COPY
		label: string

		startRequirement: {
			origins: PackageOriginOnPackage.Quantel[]
		}
		endRequirement: {
			location: PackageLocation.Quantel
			content: {
				guid?: string
				title?: string
			}
			version: any // todo
		}
	}
}
