import {
	DataId,
	Expectation,
	ExpectationManagerWorkerAgent,
	LoggerInstance,
	PackageContainerExpectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	ReturnTypeRunPackageContainerCronJob,
	stringMaxLength,
	WorkerAgentConfig,
} from '@sofie-package-manager/api'
import { GenericAccessorHandle, SetupPackageContainerMonitorsResult } from './accessorHandlers/genericHandle'
import { IWorkInProgress } from './lib/workInProgress'

export interface GenericWorkerAgentAPI {
	config: WorkerAgentConfig
	location: WorkerLocation
	/**
	 * Acquire a read/write lock to a data point, then write the result of the callback to it.
	 * This is used to prevent multiple workers from working on the same data point at the same time.
	 */
	workerStorageWrite: <T>(
		dataId: DataId,
		customTimeout: number | undefined,
		cb: (current: T | undefined) => Promise<T> | T
	) => Promise<void>
	workerStorageRead: <T>(dataId: DataId) => Promise<T | undefined>
}

/**
 * A Worker runs static stateless/lambda functions.
 */
export abstract class BaseWorker {
	/** A space where the AccessorHandlers can store various things, such as persistent connections, etc.. */
	public accessorCache: { [accessorType: string]: unknown } = {}
	private _uniqueId = 0

	constructor(
		public logger: LoggerInstance,
		public readonly agentAPI: GenericWorkerAgentAPI,
		public sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker,
		public type: string
	) {}

	/** Locally unique number */
	get uniqueId(): number {
		return this._uniqueId++
	}
	/** Called upon startup */
	abstract init(): Promise<void>

	/** Called upon termination */
	abstract terminate(): void
	/**
	 * Does the worker support this expectation?
	 * This includes things like:
	 * * Being able to access/read/write to the sources and targets
	 */
	abstract doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation>
	/**
	 * Estimate the cost for fulfilling an expectation.
	 * The returned cost is later used to determine which worker is going to get the job.
	 * (lower cost = cheaper/quicker)
	 */
	abstract getCostFortExpectation(exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation>
	/**
	 * Check if we the start requirements are in place for work on an expectation to start.
	 * If Yes, workOnExpectation() will be called shortly after.
	 */
	abstract isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
	/**
	 * Check if the expectation is fulfilled or not.
	 * (If the expectation is already fulfilled, theres no need to workOnExpectation().)
	 */
	abstract isExpectationFulfilled(
		exp: Expectation.Any,
		wasFulfilled: boolean
	): Promise<ReturnTypeIsExpectationFulfilled>
	/**
	 * Start working on fulfilling an expectation.
	 * @returns a WorkInProgress, upon beginning of the work. WorkInProgress then handles signalling of the work progress.
	 */
	abstract workOnExpectation(
		exp: Expectation.Any,
		/** An FYI, the work will be considered timed out if there are no progression reports within this interval*/
		progressTimeout: number
	): Promise<IWorkInProgress>
	/**
	 * "Make an expectation un-fulfilled"
	 * This is called when an expectation has been removed.
	 */
	abstract removeExpectation(exp: Expectation.Any, reason: string): Promise<ReturnTypeRemoveExpectation>

	/**
	 * Does the worker support this packageContainer?
	 * This includes things like:
	 * Being able to access/read/write to the packageContainer
	 */
	abstract doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportPackageContainer>
	/** Execute a cronjob on the packageContainer */
	abstract runPackageContainerCronJob(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeRunPackageContainerCronJob>
	/** Set up monitors for this PackageContainer */
	abstract setupPackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult>

	/**
	 * Log a message when doing an operation
	 */
	logOperation(message: string): void {
		this.logger.verbose(message)
	}
	/**
	 * Log when an operation with a source and a target is performed
	 * @param operationName Name of the operation, eg: Copy file
	 * @param source Name of the source
	 * @param target Name of the target
	 * @returns
	 */
	logWorkOperation(
		expectationId: string,
		operationName: string,
		source: string | GenericAccessorHandle<any>,
		target: string | GenericAccessorHandle<any>
	): { logDone: () => void } {
		const msg = `${stringMaxLength(expectationId, 16)}: ${operationName} from "${
			typeof source === 'string' ? source : source.packageName
		}" to "${typeof target === 'string' ? target : target.packageName}"`

		this.logger.verbose(`${msg}...`)
		return {
			logDone: () => {
				this.logger.verbose(`${msg}, done!`)
			},
		}
	}

	private _accessorTemporaryCache: {
		[accessorType: string]: {
			[key: string]: {
				/** timestamp */
				validTo: number
				data: any
			}
		}
	} = {}
	private _accessorTemporaryCacheCleanupTimeout: NodeJS.Timeout | undefined
	private _accessorTemporaryCacheCleanup() {
		const now = Date.now()
		for (const accessorType of Object.keys(this._accessorTemporaryCache)) {
			const cache = this._accessorTemporaryCache[accessorType]
			for (const key in cache) {
				if (cache[key].validTo <= now) {
					delete cache[key]
				}
			}
		}
	}
	/**
	 * Store and access data. Useful to debounce / rate limit external calls
	 * @example
	 * const data = await this.worker.cacheTemporaryData(this.type, url, () => getData(url))
	 * */
	public async cacheData<T>(accessorType: string, key: string, cb: () => Promise<T>, ttl = 1000): Promise<T> {
		// Check if data is in cache:
		if (!this._accessorTemporaryCache[accessorType]) this._accessorTemporaryCache[accessorType] = {}
		const cache = this._accessorTemporaryCache[accessorType]
		const now = Date.now()
		if (cache[key] && cache[key].validTo >= now) {
			return cache[key].data
		}

		const data = await cb()
		cache[key] = {
			validTo: now + ttl,
			data: data,
		}
		if (!this._accessorTemporaryCacheCleanupTimeout) {
			this._accessorTemporaryCacheCleanupTimeout = setTimeout(() => {
				this._accessorTemporaryCacheCleanupTimeout = undefined
				this._accessorTemporaryCacheCleanup()
			}, 1000)
		}
		return data
	}
}
export interface WorkerLocation {
	/** The name/identifier of the computer that this runs on */
	localComputerId?: string
	/** The names/identifiers of the local network that this has access to */
	localNetworkIds: string[]
}
