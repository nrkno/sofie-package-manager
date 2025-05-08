import {
	StatusCode,
	ClientConnectionOptions,
	Expectation,
	ExpectationManagerWorkerAgent,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	WorkForceWorkerAgent,
	Hook,
	LoggerInstance,
	WorkerConfig,
	literal,
	PackageContainerExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeRunPackageContainerCronJob,
	ReturnTypeSetupPackageContainerMonitors,
	ReturnTypeDisposePackageContainerMonitors,
	LogLevel,
	APPCONTAINER_PING_TIME,
	MonitorProperties,
	Reason,
	stringifyError,
	WorkerStatusReport,
	setLogLevel,
	AppContainerWorkerAgent,
	deferGets,
	promiseTimeout,
	INNER_ACTION_TIMEOUT,
	protectString,
	ExpectationManagerId,
	MonitorId,
	PackageContainerId,
	WorkerAgentId,
	DataId,
	isProtectedString,
	WorkInProgressLocalId,
	objectEntries,
	Cost,
	assertNever,
	KnownReason,
} from '@sofie-package-manager/api'

import { AppContainerAPI } from './appContainerApi'
import { CPUTracker } from './cpuTracker'
import { ExpectationManagerAPI } from './expectationManagerApi'
import { MonitorInProgress } from './worker/lib/monitorInProgress'
import { IWorkInProgress } from './worker/lib/workInProgress'
import { BaseWorker } from './worker/worker'
import { GenericWorker } from './worker/workers/genericWorker/genericWorker'
import { WorkforceAPI } from './workforceApi'
import { DummyAppContainerAPI, NoClientConnectionOptions } from './dummyAppContainerApi'

/** The WorkerAgent is a front for a Worker (@see GenericWorker).
 * It is intended to be the main class in its worker-process, and handles things like communication with the WorkForce or the Expectation-Manager
 */

export class WorkerAgent {
	private _worker: BaseWorker
	// private _busyMethodCount = 0
	private workforceAPI: WorkforceAPI
	private appContainerAPI: AppContainerAPI
	private _wipI = 0
	private currentJobs: CurrentJob[] = []
	public readonly id: WorkerAgentId
	private workForceConnectionOptions: ClientConnectionOptions
	private appContainerConnectionOptions: ClientConnectionOptions | NoClientConnectionOptions

	private expectationManagers: Map<
		ExpectationManagerId,
		{
			url: string
			api: ExpectationManagerAPI
		}
	> = new Map()
	private expectationManagerHooks: Map<
		ExpectationManagerId,
		Hook<ExpectationManagerWorkerAgent.ExpectationManager, ExpectationManagerWorkerAgent.WorkerAgent>
	> = new Map()
	private terminated = false
	private spinDownTime = 0
	private intervalCheckTimer: NodeJS.Timeout | null = null
	private lastWorkTime = 0
	private failureCounter = 0
	private failurePeriodCounter = 0
	private intervalFailureTimer: NodeJS.Timeout | null = null
	private activeMonitors: Map<PackageContainerId, Map<MonitorId, MonitorInProgress>> = new Map()
	private initWorkForceAPIPromise?: { resolve: () => void; reject: (reason?: any) => void }
	private initAppContainerAPIPromise?: { resolve: () => void; reject: (reason?: any) => void }
	private cpuTracker = new CPUTracker()
	/** When true, this worker should only accept expectation that are critical for playout */
	private isOnlyForCriticalExpectations = false
	private logger: LoggerInstance

	private workerStorageDeferRead = deferGets(async (dataId: DataId) => {
		return this.appContainerAPI.workerStorageRead(dataId)
	})

	constructor(logger: LoggerInstance, private config: WorkerConfig) {
		this.logger = logger.category('WorkerAgent')
		this.id = config.worker.workerId

		this.workForceConnectionOptions = this.config.worker.workforceURL
			? {
					type: 'websocket',
					url: this.config.worker.workforceURL,
			  }
			: {
					type: 'internal',
			  }
		this.appContainerConnectionOptions = !this.config.worker.appContainerURL
			? {
					type: 'none',
			  }
			: this.config.worker.appContainerURL === 'internal'
			? {
					type: 'internal',
			  }
			: {
					type: 'websocket',
					url: this.config.worker.appContainerURL,
			  }

		this.workforceAPI = new WorkforceAPI(this.id, this.logger)
		this.workforceAPI.on('disconnected', () => {
			this.logger.warn('Worker: Workforce disconnected')
		})
		this.workforceAPI.on('connected', () => {
			this.logger.info('Worker: Workforce connected')

			Promise.resolve()
				.then(async () => {
					const list = await this.workforceAPI.getExpectationManagerList()
					if (!list.length) {
						this.logger.warn('Worker: List of expectationManagers is empty')
					}
					await this.updateListOfExpectationManagers(list)
				})
				.then(() => {
					this.initWorkForceAPIPromise?.resolve() // To finish the init() function
				})
				.catch((err) => {
					this.logger.error(`Worker: Error in async connected function: ${stringifyError(err)}`)
					this.initWorkForceAPIPromise?.reject(err)
				})
		})
		this.workforceAPI.on('error', (err) => {
			this.logger.error(`WorkerAgent: WorkforceAPI error event: ${stringifyError(err)}`)
		})

		if (this.appContainerConnectionOptions.type === 'none') {
			this.appContainerAPI = new DummyAppContainerAPI(this.id, this.logger)
		} else {
			this.appContainerAPI = new AppContainerAPI(this.id, this.logger)
			this.appContainerAPI.on('disconnected', () => {
				this.logger.warn('Worker: AppContainer disconnected')
			})
			this.appContainerAPI.on('connected', () => {
				this.logger.info('Worker: AppContainer connected')
				this.initAppContainerAPIPromise?.resolve() // To finish the init() function
			})
			this.appContainerAPI.on('error', (err) => {
				this.logger.error(`WorkerAgent: AppContainerAPI error event: ${stringifyError(err)}`)
			})
		}

		this.isOnlyForCriticalExpectations = this.config.worker.pickUpCriticalExpectationsOnly
		// Todo: Different types of workers:
		this._worker = new GenericWorker(
			this.logger,
			{
				location: {
					// todo: tmp:
					localComputerId: this.config.worker.resourceId,
					localNetworkIds: this.config.worker.networkIds,
				},
				config: this.config.worker,
				workerStorageRead: async (dataId: DataId) => {
					// return this.appContainerAPI.workerStorageRead(dataId)

					return this.workerStorageDeferRead(dataId, dataId)
				},
				workerStorageWrite: async (
					dataId: DataId,
					customTimeout: number | undefined,
					cb: (current: any | undefined) => Promise<any> | any
				) => {
					// First, acquire a lock to the data, so that no-one else can read/write to it:
					const { lockId, current } = await this.appContainerAPI.workerStorageWriteLock(dataId, customTimeout)
					try {
						// Then, execute the callback:
						// const writeData = await Promise.resolve(cb(current))
						const writeData = await promiseTimeout(
							Promise.resolve(cb(current)),
							(customTimeout ?? INNER_ACTION_TIMEOUT) - 10,
							(timeoutDuration: number) => {
								return `workerStorageWrite function "${dataId}" didn't resolve in time (after ${timeoutDuration} ms)`
							}
						)
						// Finally, write the data:
						await this.appContainerAPI.workerStorageWrite(dataId, lockId, writeData)
					} catch (err) {
						// Better release the lock, to avoid it running into a timeout:
						this.appContainerAPI.workerStorageReleaseLock(dataId, lockId).catch((err2) => {
							this.logger.error(`Error releasing lock: ${stringifyError(err2)}`)
						})

						throw err
					}
				},
			},

			async (
				managerId: ExpectationManagerId,
				message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any
			) => {
				// Forward the message to the expectationManager:

				const manager = this.expectationManagers.get(managerId)
				if (!manager) throw new Error(`ExpectationManager "${managerId}" not found`)

				return manager.api.messageFromWorker(message)
			}
		)
	}
	async init(): Promise<void> {
		this.logger.info(`WorkerAgent.init: Initializing...`)

		await this._worker.init()

		// Connect to AppContainer
		if (this.appContainerConnectionOptions.type === 'websocket') {
			this.logger.info(`Worker: Connecting to AppContainer at "${this.appContainerConnectionOptions.url}"`)
		}

		if (
			this.appContainerConnectionOptions.type === 'internal' ||
			this.appContainerConnectionOptions.type === 'websocket'
		) {
			const pAppContainer = new Promise<void>((resolve, reject) => {
				this.initAppContainerAPIPromise = { resolve, reject }
			})
			await this.appContainerAPI.init(this.appContainerConnectionOptions, {
				setLogLevel: async (logLevel: LogLevel) => this.setLogLevel(logLevel),
				_debugKill: async () => this._debugKill(),

				doYouSupportExpectation: async (exp: Expectation.Any) => this.doesWorkerSupportExpectation(exp),
				doYouSupportPackageContainer: async (packageContainer: PackageContainerExpectation) =>
					this.doesWorkerSupportPackageContainer(packageContainer),
				setSpinDownTime: async (spinDownTime: number) => this.setSpinDownTime(spinDownTime),
			})
			// Wait for this.appContainerAPI to be ready before continuing:
			await pAppContainer
		}

		// Connect to WorkForce:
		if (this.workForceConnectionOptions.type === 'websocket') {
			this.logger.info(`Worker: Connecting to Workforce at "${this.workForceConnectionOptions.url}"`)
		}
		const pWorkForce = new Promise<void>((resolve, reject) => {
			this.initWorkForceAPIPromise = { resolve, reject }
		})
		await this.workforceAPI.init(this.workForceConnectionOptions, {
			setLogLevel: async (logLevel: LogLevel) => this.setLogLevel(logLevel),
			_debugKill: async () => this._debugKill(),
			_debugSendKillConnections: async () => this._debugSendKillConnections(),
			getStatusReport: async () => this.getStatusReport(),

			expectationManagerAvailable: async (id: ExpectationManagerId, url: string) =>
				this.expectationManagerAvailable(id, url),
			expectationManagerGone: async (id: ExpectationManagerId) => this.expectationManagerGone(id),
		})
		// Wait for this.workforceAPI to be ready before continuing:
		await pWorkForce

		this.setupIntervalErrorCheck()

		this.IDidSomeWork()
	}
	terminate(): void {
		this.logger.info(`WorkerAgent.terminate: Terminating...`)

		this.terminated = true
		this.workforceAPI.terminate()

		if (this.intervalFailureTimer) clearInterval(this.intervalFailureTimer)

		for (const expectationManager of this.expectationManagers.values()) {
			expectationManager.api.terminate()
		}
		for (const currentJob of this.currentJobs) {
			if (currentJob.wipId) {
				this.cancelJob(currentJob).catch((error) => {
					this.logger.error(`WorkerAgent.terminate: Error in cancelJob: ${stringifyError(error)}`)
				})
			}
		}
		if (this.intervalCheckTimer) clearInterval(this.intervalCheckTimer)
		this.cpuTracker.terminate()
		this._worker.terminate()
	}
	/** Called when running in the same-process-mode */
	hookToWorkforce(hook: Hook<WorkForceWorkerAgent.WorkForce, WorkForceWorkerAgent.WorkerAgent>): void {
		this.workforceAPI.hook(hook)
	}
	hookToExpectationManager(
		managerId: ExpectationManagerId,
		hook: Hook<ExpectationManagerWorkerAgent.ExpectationManager, ExpectationManagerWorkerAgent.WorkerAgent>
	): void {
		this.expectationManagerHooks.set(managerId, hook)
	}
	hookToAppContainer(hook: Hook<AppContainerWorkerAgent.AppContainer, AppContainerWorkerAgent.WorkerAgent>): void {
		this.appContainerAPI.hook(hook)
	}

	/** Keep track of the promise returned by fcn and when it's resolved, to determine how busy we are */
	// private async setBusy<T>(fcn: () => Promise<T>): Promise<T> {
	// 	this._busyMethodCount++
	// 	try {
	// 		const result = await fcn()
	// 		this._busyMethodCount--
	// 		return result
	// 	} catch (err) {
	// 		this._busyMethodCount--
	// 		throw err
	// 	}
	// }
	// isFree(): boolean {
	// 	return this._busyMethodCount === 0
	// }
	private async doesWorkerSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		if (this.isOnlyForCriticalExpectations && !exp.workOptions.requiredForPlayout) {
			return {
				support: false,
				knownReason: true,
				reason: {
					user: 'Worker is reserved for playout-critical operations',
					tech: 'Worker is reserved for `workOptions.requiredForPlayout` expectations',
				},
			}
		}

		return this._worker.doYouSupportExpectation(exp)
	}
	private async doesWorkerSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportExpectation> {
		return this._worker.doYouSupportPackageContainer(packageContainer)
	}
	private async expectationManagerAvailable(managerId: ExpectationManagerId, url: string): Promise<void> {
		const existing = this.expectationManagers.get(managerId)
		if (existing) {
			existing.api.terminate()
		}

		await this.connectToExpectationManager(managerId, url)
	}
	private async expectationManagerGone(managerId: ExpectationManagerId): Promise<void> {
		this.expectationManagers.delete(managerId)
	}
	public async setLogLevel(logLevel: LogLevel): Promise<void> {
		setLogLevel(logLevel)
	}
	async _debugKill(): Promise<void> {
		this.terminate()
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}
	/** FOR DEBUGGING ONLY. Cut websocket connections, in order to ensure that they are restarted */
	async _debugSendKillConnections(): Promise<void> {
		this.workforceAPI.debugCutConnection()
		this.appContainerAPI.debugCutConnection()
	}
	async getStatusReport(): Promise<WorkerStatusReport> {
		const activeMonitors: WorkerStatusReport['activeMonitors'] = []

		for (const [containerId, monitors] of this.activeMonitors.entries()) {
			for (const [monitorId, monitor] of monitors.entries()) {
				activeMonitors.push({
					containerId: containerId,
					monitorId: monitorId,
					label: monitor.properties.label,
				})
			}
		}

		return {
			id: this.id,
			activeMonitors,
			currentJobs: this.currentJobs.map((job) => ({
				cost: job.cost.cost,
				startCost: job.cost.startCost,
				cancelled: job.cancelled,
				wipId: job.wipId,
				progress: Math.floor(job.progress * 1000) / 1000,
				lastUpdated: job.lastUpdated,
			})),
		}
	}
	/** Set the SpinDown Time [ms] */
	public async setSpinDownTime(spinDownTime: number): Promise<void> {
		this.spinDownTime = spinDownTime
		this.setupIntervalCheck()
	}
	private getStartCost(exp: Expectation.Any): { cost: Cost; jobCount: number } {
		const workerMultiplier: number = this.config.worker.costMultiplier || 1

		let systemStartCost = 0
		if (this.config.worker.considerCPULoad !== null) {
			if (exp.workOptions.allowWaitForCPU) {
				if (exp.workOptions.usesCPUCount && exp.workOptions.usesCPUCount > this.cpuTracker.idleCPUCount) {
					// If we don't have the cpu's available right now, we should wait until they are:
					systemStartCost += 60 * 1000 // arbitrary cost
				}
			}
		}
		let resultingCost: Cost = systemStartCost
		for (const job of this.currentJobs) {
			// null means that the cost is "infinite"
			if (resultingCost === null) break

			if (job.cost.cost === null) resultingCost = null
			else resultingCost += job.cost.cost * (1 - job.progress) * workerMultiplier
		}

		return {
			cost: resultingCost,
			jobCount: this.currentJobs.length,
		}
	}

	private async createNewJobForExpectation(
		managerId: ExpectationManagerId,
		exp: Expectation.Any,
		cost: ExpectationManagerWorkerAgent.ExpectationCost,
		/** Timeout, cancels the job if no updates are received in this time [ms] */
		timeout: number
	): Promise<ExpectationManagerWorkerAgent.WorkInProgressInfo> {
		const expectationManager = this.expectationManagers.get(managerId)
		if (!expectationManager) {
			this.logger.error(
				`Worker "${this.id}" could not start job for expectation (${exp.id}), because it could not find expectation manager "${managerId}"`
			)

			throw new Error(`ExpectationManager "${managerId}" not found`)
		}

		// Tmp: we're only allowing one work per worker
		if (this.currentJobs.length > 0) {
			this.logger.warn(
				`createNewJobForExpectation called, even though there are ${
					this.currentJobs.length
				} current jobs. StartCost now: ${this.getStartCost(exp).cost}, specified cost=${
					cost.cost
				}, specified startCost=${cost.startCost}`
			)
		}

		const currentJob: CurrentJob = {
			cost: cost,
			cancelled: false,
			lastUpdated: Date.now(),
			progress: 0,
			wipId: this.getNextWipId(),
			workInProgress: null,
			timeoutInterval: setInterval(() => {
				if (currentJob.cancelled && currentJob.timeoutInterval) {
					clearInterval(currentJob.timeoutInterval)
					currentJob.timeoutInterval = null
					return
				}
				const timeSinceLastUpdate = Date.now() - currentJob.lastUpdated

				if (timeSinceLastUpdate > timeout) {
					// The job seems to have timed out.
					// Expectation Manager will clean up on it's side, we have to do the same here.

					this.logger.warn(
						`WorkerAgent: Cancelling job "${currentJob.workInProgress?.properties.workLabel}" (${currentJob.wipId}) due to timeout (${timeSinceLastUpdate} > ${timeout})`
					)
					if (currentJob.timeoutInterval) {
						clearInterval(currentJob.timeoutInterval)
						currentJob.timeoutInterval = null
					}

					// Ensure that the job is removed, so that it won't block others:
					this.removeJob(currentJob)

					Promise.race([
						this.cancelJob(currentJob),
						new Promise((_, reject) => {
							setTimeout(
								() =>
									reject(
										`Timeout when cancelling job "${currentJob.workInProgress?.properties.workLabel}" (${currentJob.wipId})`
									),
								1000
							)
						}),
					]).catch((error) => {
						// Not much we can do about that error..
						this.logger.error(
							`WorkerAgent: timeout watch: Error in cancelJob (${currentJob.wipId}) ${stringifyError(
								error
							)}`
						)
					})
				}
			}, 1000),
		}
		this.currentJobs.push(currentJob)
		this.logger.debug(
			`Worker "${this.id}" starting job ${currentJob.wipId}, (${exp.id}). (${this.currentJobs.length})`
		)

		try {
			const workInProgress = await this.makeWorkerWorkOnJobForExpectation(managerId, currentJob, exp, timeout)

			return {
				wipId: currentJob.wipId,
				properties: workInProgress.properties,
			}
		} catch (err) {
			// makeWorkerWorkOnExpectation() / _worker.workOnExpectation() failed.

			this.removeJob(currentJob)
			this.logger.warn(
				`Worker "${this.id}" stopped job ${currentJob.wipId}, (${exp.id}), due to initial error. (${this.currentJobs.length})`
			)

			throw err
		}
	}

	private async makeWorkerWorkOnJobForExpectation(
		managerId: ExpectationManagerId,
		job: CurrentJob,
		exp: Expectation.Any,
		/** Timeout, cancels the job if no updates are received in this time [ms] */
		timeout: number
	): Promise<IWorkInProgress> {
		const workInProgress = await this._worker.workOnExpectation(exp, timeout)

		job.workInProgress = workInProgress

		workInProgress.on('progress', (actualVersionHash, progress: number) => {
			this.IDidSomeWork()
			if (job.cancelled) return // Don't send updates on cancelled work
			job.lastUpdated = Date.now()
			job.progress = progress

			const expectationManager = this.expectationManagers.get(managerId)
			if (!expectationManager) {
				this.logger.warn(
					`Could not report work progress to Expectation Manager "${managerId}", because the manager could not be found.`
				)
				return
			}

			expectationManager?.api.wipEventProgress(job.wipId, actualVersionHash, progress).catch((err) => {
				if (!this.terminated) {
					this.logger.error(`Error in wipEventProgress: ${stringifyError(err)}`)
				}
			})
		})
		workInProgress.on('error', (error: string) => {
			this.IDidSomeWork()
			if (job.cancelled) return // Don't send updates on cancelled work
			job.lastUpdated = Date.now()
			this.IFailed()
			this.removeJob(job)
			this.logger.warn(
				`Worker "${this.id}" stopped job ${job.wipId}, (${exp.id}), due to error: (${
					this.currentJobs.length
				}): ${stringifyError(error)}`
			)

			const expectationManager = this.expectationManagers.get(managerId)
			if (!expectationManager) {
				this.logger.warn(
					`Could not report work error to Expectation Manager "${managerId}", because the manager could not be found.`
				)
				return
			}

			expectationManager?.api
				.wipEventError(job.wipId, {
					user: 'Work aborted due to an error',
					tech: error,
				})
				.catch((err) => {
					if (!this.terminated) {
						this.logger.error(`Error in wipEventError: ${stringifyError(err)}`)
					}
				})
		})
		workInProgress.on('done', (actualVersionHash, reason, result) => {
			this.IDidSomeWork()
			if (job.cancelled) return // Don't send updates on cancelled work
			job.lastUpdated = Date.now()
			this.removeJob(job)
			this.logger.debug(
				`Worker "${this.id}" stopped job ${job.wipId}, (${exp.id}), done. (${this.currentJobs.length})`
			)

			const expectationManager = this.expectationManagers.get(managerId)
			if (!expectationManager) {
				this.logger.warn(
					`Could not report work done to Expectation Manager "${managerId}", because the manager could not be found.`
				)
				return
			}

			expectationManager?.api.wipEventDone(job.wipId, actualVersionHash, reason, result).catch((err) => {
				if (!this.terminated) {
					this.logger.error(`Error in wipEventDone: ${stringifyError(err)}`)
				}
			})
		})

		return workInProgress
	}

	private async connectToExpectationManager(managerId: ExpectationManagerId, url: string): Promise<void> {
		this.logger.info(`Worker: Connecting to Expectation Manager "${managerId}" at url "${url}"`)
		const expectationManager = {
			url: url,
			api: new ExpectationManagerAPI(this.id, this.logger),
		}
		expectationManager.api.on('disconnected', () => {
			this.logger.warn('Worker: ExpectationManager disconnected')
		})
		expectationManager.api.on('connected', () => {
			this.logger.info('Worker: ExpectationManager connected')
		})
		expectationManager.api.on('error', (err) => {
			this.logger.error(`WorkerAgent: ExpectationManagerAPI error event: ${stringifyError(err)}`)
		})
		this.expectationManagers.set(managerId, expectationManager)

		const methods = literal<Omit<ExpectationManagerWorkerAgent.WorkerAgent, 'id'>>({
			doYouSupportExpectation: async (exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> => {
				return this.doesWorkerSupportExpectation(exp)
			},
			getCostForExpectation: async (
				exp: Expectation.Any
			): Promise<ExpectationManagerWorkerAgent.ExpectationCost> => {
				const costForExpectation = await this._worker.getCostFortExpectation(exp)

				let workerMultiplier: number = this.config.worker.costMultiplier || 1

				if (this.config.worker.considerCPULoad !== null) {
					// adjust the workerMultiplier based on the current cpu usage, so that workers that are on systems with low CPU usage will be prioritized:
					workerMultiplier /= Math.min(1, Math.max(0.1, 1 - this.cpuTracker.cpuUsage))
				}

				const startCost = this.getStartCost(exp)

				return {
					cost: costForExpectation.cost !== null ? costForExpectation.cost * workerMultiplier : null,
					reason: {
						user: costForExpectation.reason.user,
						tech: `Cost: ${costForExpectation.reason.tech}, multiplier: ${workerMultiplier}, jobCount: ${startCost.jobCount}`,
					},
					startCost: startCost.cost,
				}
			},
			isExpectationReadyToStartWorkingOn: async (
				exp: Expectation.Any
			): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
				return this._worker.isExpectationReadyToStartWorkingOn(exp)
			},
			isExpectationFulfilled: async (
				exp: Expectation.Any,
				wasFulfilled: boolean
			): Promise<ReturnTypeIsExpectationFulfilled> => {
				return this._worker.isExpectationFulfilled(exp, wasFulfilled)
			},
			workOnExpectation: async (
				exp: Expectation.Any,
				cost: ExpectationManagerWorkerAgent.ExpectationCost,
				/** Timeout, cancels the job if no updates are received in this time [ms] */
				timeout: number
			): Promise<ExpectationManagerWorkerAgent.WorkInProgressInfo> => {
				this.IDidSomeWork()
				return this.createNewJobForExpectation(managerId, exp, cost, timeout)
			},
			removeExpectation: async (exp: Expectation.Any, reason: string): Promise<ReturnTypeRemoveExpectation> => {
				return this._worker.removeExpectation(exp, reason)
			},
			cancelWorkInProgress: async (wipId: WorkInProgressLocalId): Promise<void> => {
				return this.cancelJob(wipId)
			},
			doYouSupportPackageContainer: async (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeDoYouSupportPackageContainer> => {
				return this.doesWorkerSupportPackageContainer(packageContainer)
			},
			runPackageContainerCronJob: async (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeRunPackageContainerCronJob> => {
				return this._worker.runPackageContainerCronJob(packageContainer)
			},
			setupPackageContainerMonitors: async (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeSetupPackageContainerMonitors> => {
				let activeMonitor = this.activeMonitors.get(packageContainer.id)
				if (activeMonitor === undefined) {
					activeMonitor = new Map()
					this.activeMonitors.set(packageContainer.id, activeMonitor)
				}

				const result = await this._worker.setupPackageContainerMonitors(packageContainer)
				if (result.success) {
					const returnMonitors: Record<MonitorId, MonitorProperties> = {}

					for (const [monitorId, monitorInProgress] of objectEntries(result.monitors)) {
						activeMonitor.set(monitorId, monitorInProgress)
						returnMonitors[monitorId] = monitorInProgress.properties

						monitorInProgress.removeAllListeners('error') // Replace any temporary listeners
						monitorInProgress.on('error', (internalError: unknown) => {
							this.logger.error(
								`WorkerAgent.methods.setupPackageContainerMonitors: ${JSON.stringify(internalError)}`
							)
							expectationManager.api
								.monitorStatus(packageContainer.id, monitorId, StatusCode.FATAL, {
									user: 'Internal Error',
									tech: stringifyError(internalError),
								})
								.catch((err) => {
									if (!this.terminated) {
										this.logger.error(
											`WorkerAgent.methods.setupPackageContainerMonitors: monitorInProgress error event: expectedManager.api.monitorStatus Error when setting status: ${stringifyError(
												err
											)}`
										)
									}
								})
						})
						monitorInProgress.on('status', (status: StatusCode, reason: Reason) => {
							expectationManager.api
								.monitorStatus(packageContainer.id, monitorId, status, reason)
								.catch((err) => {
									if (!this.terminated) {
										this.logger.error(
											`WorkerAgent.methods.setupPackageContainerMonitors: monitorInProgress status event: expectedManager.api.monitorStatus Error when setting status: ${stringifyError(
												err
											)}`
										)
									}
								})
						})
					}

					return {
						success: true,
						monitors: returnMonitors,
					}
				} else {
					return result
				}
			},
			disposePackageContainerMonitors: async (
				packageContainerId: PackageContainerId
			): Promise<ReturnTypeDisposePackageContainerMonitors> => {
				let errorReason: null | {
					knownReason: KnownReason
					reason: Reason
				} = null

				const activeMonitors = this.activeMonitors.get(packageContainerId)
				if (!activeMonitors) return { success: true } // nothing to dispose of

				for (const [monitorId, monitor] of activeMonitors.entries()) {
					try {
						await monitor.stop()
						activeMonitors.delete(monitorId)
					} catch (err) {
						errorReason = {
							knownReason: false,
							reason: {
								user: 'Unable to stop monitor',
								tech: `Error: ${stringifyError(err)}`,
							},
						}
					}
				}
				if (!errorReason) return { success: true }
				else return { success: false, knownReason: errorReason.knownReason, reason: errorReason.reason }
			},
		})
		// Wrap the methods, so that we can cut off communication upon termination: (this is used in tests)
		for (const key of Object.keys(methods) as Array<keyof Omit<ExpectationManagerWorkerAgent.WorkerAgent, 'id'>>) {
			const fcn = methods[key]
			methods[key] = (async (...args: any[]) => {
				if (this.terminated)
					return new Promise((_resolve, reject) => {
						// Simulate a timed out message:
						setTimeout(() => {
							reject('Timeout')
						}, 200)
					})
				try {
					const operationStartTime = performance.now()

					const result = await ((fcn as any)(...args) as ReturnType<typeof fcn>)

					const operationDuration = Math.floor((performance.now() - operationStartTime) * 10) / 10

					this.logger.silly(`Operation "${key}" took ${operationDuration}ms`)

					let knownReason = true
					if (result) {
						// This is a bit of a hack, to access the various result properties type safely:
						if ('support' in result) {
							if (!result.support) knownReason = result.knownReason
						} else if ('fulfilled' in result) {
							if (!result.fulfilled) knownReason = result.knownReason
						} else if ('removed' in result) {
							if (!result.removed) knownReason = result.knownReason
						} else if ('success' in result) {
							if (!result.success) knownReason = result.knownReason
						} else if ('ready' in result) {
							if (!result.ready) knownReason = result.knownReason
						} else if ('cost' in result) {
							// do nothing
						} else if ('wipId' in result) {
							// do nothing
						} else {
							assertNever(result)
						}
					}
					if (!knownReason) {
						// treat the unsuccessful result as an error:
						this.IFailed()
					}
					return result
				} catch (err) {
					this.IFailed()
					throw err
				}
			}) as any
		}
		// Connect to the ExpectationManager:
		if (url === '__internal') {
			// This is used for an internal connection:
			const managerHookHook = this.expectationManagerHooks.get(managerId)

			if (!managerHookHook)
				throw new Error(
					`WorkerAgent.connectToExpectationManager: manager hook not found for manager "${managerId}", call hookToExpectationManager() first!`
				)
			expectationManager.api.hook(managerHookHook)
		}

		const connectionOptions: ClientConnectionOptions =
			url === '__internal' ? { type: 'internal' } : { type: 'websocket', url: expectationManager.url }

		await expectationManager.api.init(connectionOptions, methods)
	}

	private async updateListOfExpectationManagers(newExpectationManagers: { id: ExpectationManagerId; url: string }[]) {
		const ids = new Set<ExpectationManagerId>()
		for (const newEm of newExpectationManagers) {
			ids.add(newEm.id)

			const em = this.expectationManagers.get(newEm.id)
			if (!em || em.url !== newEm.url) {
				// added or changed
				await this.expectationManagerAvailable(newEm.id, newEm.url)
			}
		}
		// Removed
		for (const id of this.expectationManagers.keys()) {
			if (!ids.has(id)) {
				// removed
				await this.expectationManagerGone(id)
			}
		}
	}
	private async cancelJob(currentJobOrId: CurrentJob | WorkInProgressLocalId): Promise<void> {
		let wipId: WorkInProgressLocalId
		let currentJob: CurrentJob | undefined
		if (isProtectedString(currentJobOrId)) {
			wipId = currentJobOrId
			currentJob = this.currentJobs.find((job) => job.wipId === wipId)
		} else {
			currentJob = currentJobOrId
			wipId = currentJob.wipId
		}

		if (currentJob) {
			if (currentJob.workInProgress) {
				await currentJob.workInProgress.cancel()
				currentJob.workInProgress = null
			}
			this.removeJob(currentJob)
		}
	}
	private removeJob(currentJob: CurrentJob): void {
		currentJob.cancelled = true
		this.currentJobs = this.currentJobs.filter((job) => job !== currentJob)
	}
	private setupIntervalCheck() {
		if (!this.intervalCheckTimer) {
			this.intervalCheckTimer = setInterval(() => {
				this.intervalCheck()
			}, APPCONTAINER_PING_TIME)
		}
	}
	private intervalCheck() {
		// Check the SpinDownTime:
		if (this.spinDownTime) {
			if (Date.now() - this.lastWorkTime > this.spinDownTime) {
				// Enough time has passed, it is time to ask to spin us down.

				this.IDidSomeWork() // so that we won't ask again until later

				// Don's spin down if a monitor is active
				if (!this.activeMonitors.size) {
					this.logger.debug(`Worker: is idle, requesting spinning down`)

					this.requestShutDown()
				}
			}
		}
		// Also ping the AppContainer
		if (this.appContainerAPI.connected) {
			this.appContainerAPI.ping().catch((err) => {
				// We don't have to raise the error here if the ping fails, as reconnections are handled in other places:
				this.logger.warn(`Worker: appContainerAPI.ping failed: ${stringifyError(err)}`)
			})
		}
	}
	private requestShutDown(force?: boolean) {
		if (this.appContainerAPI.connected) {
			this.appContainerAPI.requestSpinDown(force).catch((err) => {
				this.logger.error(`Worker: appContainerAPI.requestSpinDown failed: ${stringifyError(err)}`)
			})
		} else {
			// Huh, we're not connected to the appContainer.
			// Well, we want to spin down anyway, so we'll do it:
			// eslint-disable-next-line no-process-exit
			process.exit(54)
		}
	}
	private setupIntervalErrorCheck() {
		if (this.config.worker.failurePeriodLimit <= 0) return
		if (this.intervalFailureTimer) clearInterval(this.intervalFailureTimer)
		this.intervalFailureTimer = setInterval(() => this.intervalErrorCheck(), this.config.worker.failurePeriod)
	}
	private intervalErrorCheck() {
		if (this.failureCounter === 0) {
			// reset the failurePeriodCounter when there were no exceptions in the period

			if (this.failurePeriodCounter > 0) {
				this.logger.debug(
					`Worker ErrorCheck: There was a period with 0 errors, resetting failurePeriodCounter (from ${this.failurePeriodCounter})`
				)
				this.failurePeriodCounter = 0
			} else {
				this.logger.debug(`Worker ErrorCheck: There was a period with 0 errors`)
			}
			return
		}

		if (this.failureCounter > 0) {
			this.failurePeriodCounter++
			this.logger.debug(
				`Worker ErrorCheck: There was a period with ${this.failureCounter} errors, incrementing failurePeriodCounter (to ${this.failurePeriodCounter})`
			)
			this.failureCounter = 0
		}

		if (this.failurePeriodCounter >= this.config.worker.failurePeriodLimit) {
			this.logger.error(
				`Worker ErrorCheck: Failed failurePeriodLimit check: ${this.failurePeriodCounter} periods with errors. Requesting spin down.`
			)
			this.requestShutDown(true)
		}
	}
	/**
	 * To be called when some actual work has been done.
	 * If this is not called for a certain amount of time, the worker will be considered idle and will be spun down
	 */
	private IDidSomeWork() {
		this.lastWorkTime = Date.now()
	}
	/**
	 * To be called when some work has failed
	 */
	private IFailed() {
		this.failureCounter++
	}
	private getNextWipId(): WorkInProgressLocalId {
		return protectString<WorkInProgressLocalId>(`${this._wipI++}`)
	}
}
interface CurrentJob {
	cost: ExpectationManagerWorkerAgent.ExpectationCost
	cancelled: boolean
	lastUpdated: number
	progress: number
	timeoutInterval: NodeJS.Timeout | null
	wipId: WorkInProgressLocalId
	workInProgress: IWorkInProgress | null
}
