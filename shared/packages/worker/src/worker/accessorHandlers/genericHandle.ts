import {
	AccessorOnPackage,
	Expectation,
	PackageContainerExpectation,
	Reason,
	HelpfulEventEmitter,
	AccessorId,
	MonitorId,
	promiseTimeout,
	INNER_ACTION_TIMEOUT,
	KnownReason,
	stringMaxLength,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { MonitorInProgress } from '../lib/monitorInProgress'

/**
 * The AccessorHandle provides a common API to manipulate Packages across multiple types of Accessors
 */
export abstract class GenericAccessorHandle<Metadata> {
	protected worker: BaseWorker
	public readonly accessorId: AccessorId
	protected _accessor: AccessorOnPackage.Any
	protected _content: unknown
	public readonly type: string
	public readonly context: AccessorContext
	constructor(arg: AccessorConstructorProps<AccessorOnPackage.Any> & { type: string }) {
		this.worker = arg.worker
		this.accessorId = arg.accessorId
		this._accessor = arg.accessor
		this._content = arg.content
		this.type = arg.type
		this.context = arg.context

		// Wrap all accessor methods which return promises into promiseTimeout.
		// This is to get a finer grained logging, in case of a timeout:

		/** List of all methods */
		const methodsToWrap: Array<keyof GenericAccessorHandle<Metadata>> = [
			'checkPackageReadAccess',
			'tryPackageRead',
			'checkPackageContainerWriteAccess',
			'getPackageActualVersion',
			'removePackage',
			'fetchMetadata',
			'updateMetadata',
			'removeMetadata',
			'getPackageReadStream',
			'putPackageStream',
			'getPackageReadInfo',
			'putPackageInfo',
			'prepareForOperation',
			'finalizePackage',
			'runCronJob',
			'setupPackageContainerMonitors',
		]

		for (const methodName of methodsToWrap) {
			const originalMethod = this[methodName] as (...args: any[]) => Promise<unknown>

			;(this as any)[methodName] = async function (...args: any[]) {
				return promiseTimeout(
					originalMethod.call(this, ...args),
					INNER_ACTION_TIMEOUT,
					(duration) =>
						`Timeout after ${duration} ms in ${methodName} for Accessor "${
							this.accessorId
						}". Context: ${JSON.stringify({
							type: this.type,
							accessor: this._accessor,
							content: this._content,
						})}`
				)
			}
		}
	}

	/**
	 * A string that can identify the package.
	 * For example, for a file, this could be the filepath.
	 */
	abstract get packageName(): string

	// Note: abstract static methods aren't currently supported by typescript: https://github.com/microsoft/TypeScript/issues/34516
	// But it's still the type of thing we want to have here:
	/** @returns true if the accessor is (statically) able to support access the PackageContainer */
	// abstract static doYouSupportAccess(worker: GenericWorker, accessor: AccessorOnPackage.Any): boolean

	/**
	 * Checks if there are any issues with the properties in the accessor or content for being able to be used at all.
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkHandleBasic(): AccessorHandlerCheckHandleBasicResult

	/**
	 * Checks if there are any issues with the properties in the accessor or content for being able to read
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkHandleRead(): AccessorHandlerCheckHandleReadResult
	/**
	 * Checks if there are any issues with the properties in the accessor or content for being able to write
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkHandleWrite(): AccessorHandlerCheckHandleWriteResult
	/**
	 * Checks if Accessor has access to the Package, for reading.
	 * Errors from this method are related to access/permission issues, or that the package doesn't exist.
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageReadAccess(): Promise<AccessorHandlerCheckPackageReadAccessResult>

	/**
	 * Do a check if it actually is possible to access the package.
	 * Errors from this method are related to the actual access of the package (such as resource is busy).
	 * @returns undefined if all is OK / string with error message
	 */
	abstract tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult>
	/**
	 * Checks if the PackageContainer can be written to
	 * @returns undefined if all is OK / string with error message
	 */
	abstract checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult>
	/**
	 * Extracts and returns the version from the package
	 * @returns the version of the package
	 */
	abstract getPackageActualVersion(): Promise<Expectation.Version.Any>

	/**
	 * Removes the package from the PackageContainer (if the package exists)
	 * Also removes any Metadata associated with the package
	 * @param logReason string describing why the package is removed (for logging)
	 */
	abstract removePackage(logReason: string): Promise<void>

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

	/**
	 * Called when a package-operation (like a copy etc) is about to start.
	 * This is a signal that a package is about to be put in place very soon.
	 * @param operationName Name of the operation, eg: Copy file
	 * @param source Name of the source
	 * @returns A reference to the start of an operation. This reference is passed to finalizePackage() when the operation is complete.
	 */
	abstract prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation>

	/**
	 * Finalize the package.
	 * To be called after a .putPackageStream(), putPackageInfo() or other file operation
	 * (like a write or copy) has completed.
	 * @param operation Reference to the start of an operation. Obtained from calling handle.prepareForOperation()
	 */
	abstract finalizePackage(operation: PackageOperation): Promise<void>

	/**
	 * Performs a cronjob on the Package container
	 * @returns undefined if all is OK / string with error message
	 */
	abstract runCronJob(packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerRunCronJobResult>
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
	protected logOperation(message: string): void {
		this.worker.logOperation(`${this.getIdentifier()}: ${message}`)
	}
	protected logWorkOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>,
		target: string | GenericAccessorHandle<any>
	): { logDone: () => void } {
		return this.worker.logWorkOperation(this.getIdentifier(), operationName, source, target)
	}
	private getIdentifier(): string {
		return 'expectationId' in this.context
			? stringMaxLength(this.context.expectationId, 16)
			: `packageContainer ${stringMaxLength(this.context.packageContainerId, 16)}`
	}
}

/** Default result returned from most accessorHandler-methods when the result was a success */
type AccessorHandlerResultSuccess = {
	/** Whether the action was successful or not */
	success: true
}
/** Default result returned from most accessorHandler-methods when the result was NOT a success */
type AccessorHandlerResultBad = {
	/** Whether the action was successful or not */
	success: false
	/**
	 * This is set to true if the reason for being unsuccessful is well known.
	 * If set to false, this means that there is a chance that the error originates from a Package Manager Worker,
	 * so if this happens enough times, a worker might eventually be restarted.
	 * */
	knownReason: KnownReason
	/** The reason why the action wasn't successful*/
	reason: Reason
}
/** Default result returned from most accessorHandler-methods */
export type AccessorHandlerResultGeneric = AccessorHandlerResultSuccess | AccessorHandlerResultBad

export type AccessorHandlerCheckHandleBasicResult = AccessorHandlerResultGeneric
export type AccessorHandlerCheckHandleReadResult = AccessorHandlerResultGeneric
export type AccessorHandlerCheckHandleWriteResult = AccessorHandlerCheckHandleReadResult
export type AccessorHandlerCheckPackageReadAccessResult = AccessorHandlerResultGeneric
export type AccessorHandlerTryPackageReadResult =
	| AccessorHandlerResultSuccess
	| (AccessorHandlerResultBad & {
			/** If true, indicates that the package exists at all */
			packageExists: boolean
			/** If true, indicates that the package is a placeholder */
			sourceIsPlaceholder?: boolean
	  })
export type AccessorHandlerCheckPackageContainerWriteAccessResult = AccessorHandlerResultGeneric
export type AccessorHandlerRunCronJobResult = Promise<AccessorHandlerResultGeneric>
export type SetupPackageContainerMonitorsResult =
	| (AccessorHandlerResultSuccess & {
			monitors: Record<MonitorId, MonitorInProgress>
	  })
	| AccessorHandlerResultBad
/**
 * A class emitted from putPackageStream() and putPackageInfo(), used to signal the progression of an ongoing write operation.
 * Users of this class are required to emit the events 'error' on error and 'close' upon completion
 */
export class PutPackageHandler extends HelpfulEventEmitter {
	/** If this is true, we should listen to the 'progress' event */
	public usingCustomProgressEvent = false

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
export interface PackageOperation {
	logDone: () => void
}

export interface AccessorConstructorProps<AccessorType extends AccessorOnPackage.Any> {
	worker: BaseWorker
	accessorId: AccessorId
	accessor: AccessorType
	context: AccessorContext
	content: any
	workOptions: any
}

export type AccessorContext =
	| {
			expectationId: string
	  }
	| {
			packageContainerId: string
	  }
