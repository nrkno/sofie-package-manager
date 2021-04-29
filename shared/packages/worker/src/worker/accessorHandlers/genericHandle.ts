import { AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { EventEmitter } from 'events'
import { Expectation, PackageContainerExpectation } from '@shared/api'
import { GenericWorker } from '../worker'

/**
 * The AccessorHandle provides a common API to manipulate Packages across multiple types of Accessors
 */
export abstract class GenericAccessorHandle<Metadata> {
	constructor(
		protected worker: GenericWorker,
		protected _accessor: AccessorOnPackage.Any,
		protected _content: unknown,
		public readonly type: string
	) {}

	// Note: abstract static methods aren't currently supported by typescript: https://github.com/microsoft/TypeScript/issues/34516
	// But it's still the type of thing we want to have here:
	/** @returns true if the accessor is (statically) able to support access the PackageContainer */
	// abstract static doYouSupportAccess(worker: GenericWorker, accessor: AccessorOnPackage.Any): boolean

	/**
	 * Checks if there are any issues with the properties in the accessor or content for being able to read
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkHandleRead(): string | undefined
	/**
	 * Checks if there are any issues with the properties in the accessor or content for being able to write
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkHandleWrite(): string | undefined
	/**
	 * Checks if Accesor has access to the Package, for reading.
	 * Errors from this method are related to access/permission issues, or that the package doesn't exist.
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageReadAccess(): Promise<string | undefined>

	/**
	 * Do a check if it actually is possible to access the package.
	 * Errors from this method are related to the actual access of the package (such as resource is busy).
	 * @returns undefined if all is OK / string with error message
	 */
	abstract tryPackageRead(): Promise<string | undefined>
	/**
	 * Checks if the PackageContainer can be written to
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageContainerWriteAccess(): Promise<string | undefined>
	/**
	 * Extracts and returns the version from the package
	 * @returns the vesion of the package
	 */
	abstract getPackageActualVersion(): Promise<Expectation.Version.Any>

	/**
	 * Removes the package from the PackageContainer (if the package exists)
	 * Also removes any Metadata associated with the package
	 */
	abstract removePackage(): Promise<void>

	/**
	 * Fetch the custom Metadata for a Package
	 */
	abstract fetchMetadata(): Promise<Metadata | undefined>
	/**
	 * Update the custom Metadata for a Package
	 */
	abstract updateMetadata(metadata: Metadata): Promise<void>
	/**
	 * Remove the custom Metadata for a Package.
	 * Note: This should only be called when the Metadata is removed separately from the package, metadata is also removed when calling removePackage()
	 */
	abstract removeMetadata(): Promise<void>

	/** For accessors that supports Streams: Obtain a binary read-stream that can be piped into putPackageStream() */
	abstract getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }>
	/** For accessors that supports Streams: Pipe in a stream (obtained from getPackageReadStream) */
	abstract putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler>

	/** For accessors that supports readInfo: Obtain info for reading a package, sent into putPackageInfo() */
	abstract getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }>
	/** For accessors that supports readInfo: Pipe info about a package source (obtained from getPackageReadInfo()) */
	abstract putPackageInfo(readInfo: PackageReadInfo): Promise<PutPackageHandler>

	/**
	 * Performs a cronjob on the Package container
	 * @returns undefined if all is OK / string with error message
	 */
	abstract runCronJob(packageContainerExp: PackageContainerExpectation): Promise<string | undefined>
	/**
	 * Setup monitors on the Package container
	 * @returns undefined if all is OK / string with error message
	 */
	abstract setupPackageContainerMonitors(
		packageContainerExp: PackageContainerExpectation
	): Promise<string | undefined>
	/**
	 * Tear down monitors on the Package container
	 * @returns undefined if all is OK / string with error message
	 */
	abstract disposePackageContainerMonitors(
		packageContainerExp: PackageContainerExpectation
	): Promise<string | undefined>
}

/**
 * A class emitted from putPackageStream() and putPackageInfo(), used to signal the progression of an ongoing write operation.
 * Users of this class are required to emit the events 'error' on error and 'close' upon completion
 */
export class PutPackageHandler extends EventEmitter {
	constructor(private onAbort: () => void) {
		super()
	}
	public abort(): void {
		return this.onAbort()
	}
}

export type PackageReadInfo = PackageReadInfoQuantelClip

export interface PackageReadInfoBase {
	type: PackageReadInfoBaseType
}
export enum PackageReadInfoBaseType {
	QUANTEL_CLIP = 'quantel_clip',
}
export interface PackageReadInfoQuantelClip extends PackageReadInfoBase {
	type: PackageReadInfoBaseType.QUANTEL_CLIP
	version: Expectation.Version.QuantelClip
	clipId: number
}
