import { AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { EventEmitter } from 'events'
import { Expectation } from '@shared/api'
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

	/** @returns true if the accessor is (statically) able to support access the PackageContainer */
	abstract doYouSupportAccess(): boolean

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
	 * Checks if the Package can be read from
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageReadAccess(): Promise<string | undefined>
	/**
	 * Checks if the PackageContainer can be written to
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageContainerWriteAccess(): Promise<string | undefined>
	/**
	 * Extrants and returns the version from the package
	 * @returns the vesion of the package
	 */
	abstract getPackageActualVersion(): Promise<Expectation.Version.Any>

	/**
	 * Removes the package from the PackageContainer (if the package exists)
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
	 * Remove the custom Metadata for a Package
	 */
	abstract removeMetadata(): Promise<void>

	abstract getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }>
	abstract pipePackageStream(sourceStream: NodeJS.ReadStream): Promise<PackageWriteStreamWrapper>
}

/**
 * A wrapper around a WriteStream-like return-value from pipePackageStream
 * Users of this class are encouraged to emit the events 'error' and 'close'
 */
export class PackageWriteStreamWrapper extends EventEmitter {
	constructor(private onAbort: () => void) {
		super()
	}
	public abort(): void {
		return this.onAbort()
	}
}
