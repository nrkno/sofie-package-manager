import { PackageOriginMetadata } from '@sofie-automation/blueprints-integration'

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Expectation {
	export type Any = ExpectationMediaFile

	export enum Type {
		MEDIA_FILE_COPY = 'media_file_copy',
	}

	export interface ExpectationBase {
		id: string

		type: Type

		startRequirement: any
		endRequirement: any

		// workInstructions: any
	}

	export interface ExpectationMediaFile extends ExpectationBase {
		type: Type.MEDIA_FILE_COPY

		label: string

		startRequirement: {
			origins: (
				| PackageOriginMetadata.LocalFolder
				| PackageOriginMetadata.FileShare
				| PackageOriginMetadata.MappedDrive
				| PackageOriginMetadata.HTTP
			)[]
		}
		endRequirement: {
			location: any // todo
			filePath: string
			version: {
				fileSize?: number // in bytes
				modifiedDate?: number // timestamp (ms)?: number // timestamp (ms)
				checksum?: string
				checkSumType?: 'sha' | 'md5' | 'whatever'
			}
		}

		// workInstructions: any
	}
}
