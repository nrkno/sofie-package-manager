import { EventEmitter } from 'events'
import { AccessorOnPackage, Expectation, PackageContainerExpectation, Reason } from '@shared/api'
import { GenericWorker } from '../worker'
import { MonitorInProgress } from '../lib/monitorInProgress'

/**
 * The AccessorHandle provides a common API to manipulate Packages across multiple types of Accessors
 */
export abstract class GenericAccessorHandle<Metadata> {
	constructor(
		protected worker: GenericWorker,
		public readonly accessorId: string,
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
	abstract checkHandleRead(): AccessorHandlerResult
	/**
	 * Checks if there are any issues with the properties in the accessor or content for being able to write
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkHandleWrite(): AccessorHandlerResult
	/**
	 * Checks if Accesor has access to the Package, for reading.
	 * Errors from this method are related to access/permission issues, or that the package doesn't exist.
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageReadAccess(): Promise<AccessorHandlerResult>

	/**
	 * Do a check if it actually is possible to access the package.
	 * Errors from this method are related to the actual access of the package (such as resource is busy).
	 * @returns undefined if all is OK / string with error message
	 */
	abstract tryPackageRead(): Promise<AccessorHandlerResult>
	/**
	 * Checks if the PackageContainer can be written to
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageContainerWriteAccess(): Promise<AccessorHandlerResult>
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
	abstract getPackageReadStream(): Promise<PackageReadStream>
	/** For accessors that supports Streams: Pipe in a stream (obtained from getPackageReadStream) */
	abstract putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler>

	/** For accessors that supports readInfo: Obtain info for reading a package, sent into putPackageInfo() */
	abstract getPackageReadInfo(): Promise<PackageReadInfoWrap>
	/** For accessors that supports readInfo: Pipe info about a package source (obtained from getPackageReadInfo()) */
	abstract putPackageInfo(readInfo: PackageReadInfo): Promise<PutPackageHandler>

	/** Finalize the package. To be called after a .putPackageStream() or putPackageInfo() has completed. */
	abstract finalizePackage(): Promise<void>

	/**
	 * Performs a cronjob on the Package container
	 * @returns undefined if all is OK / string with error message
	 */
	abstract runCronJob(packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerResult>
	/**
	 * Setup monitors on the Package container
	 * @returns undefined if all is OK / string with error message
	 */
	abstract setupPackageContainerMonitors(
		packageContainerExp: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult>

	protected setCache<T>(key: string, value: T): T {
		if (!this.worker.accessorCache[this.type]) {
			this.worker.accessorCache[this.type] = {}
		}
		;(this.worker.accessorCache[this.type] as any)[key] = value

		return value
	}
	protected getCache(key: string): any {
		const cache = this.worker.accessorCache[this.type] as any
		if (cache) {
			return cache[key]
		}
		return undefined
	}
	protected ensureCache<T>(key: string, defaultValue: T): T {
		const value = this.getCache(key)
		if (this.getCache(key) !== undefined) {
			return value
		} else {
			return this.setCache(key, defaultValue)
		}
	}
}

/** Default result returned from most accessorHandler-methods */
export type AccessorHandlerResult =
	| {
			/** Whether the action was successful or not */
			success: true
	  }
	| {
			/** Whether the action was successful or not */
			success: false
			/** If the action isn't successful, the reason why */
			reason: Reason
	  }

export type SetupPackageContainerMonitorsResult =
	| {
			success: true
			monitors: { [monitorId: string]: MonitorInProgress }
	  }
	| {
			success: false
			reason: Reason
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

export interface PackageReadStream {
	readStream: NodeJS.ReadableStream
	cancel: () => void
}
export interface PackageReadInfoWrap {
	readInfo: PackageReadInfo
	cancel: () => void
}
