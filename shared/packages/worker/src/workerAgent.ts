import {
	StatusCode,
	ClientConnectionOptions,
	Expectation,
	ExpectationManagerWorkerAgent,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeIsExpectationFullfilled,
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
} from '@shared/api'

import { AppContainerAPI } from './appContainerApi'
import { CPUTracker } from './cpuTracker'
import { ExpectationManagerAPI } from './expectationManagerApi'
import { MonitorInProgress } from './worker/lib/monitorInProgress'
import { IWorkInProgress } from './worker/lib/workInProgress'
import { GenericWorker } from './worker/worker'
import { WindowsWorker } from './worker/workers/windowsWorker/windowsWorker'
import { WorkforceAPI } from './workforceApi'

/** The WorkerAgent is a front for a Worker (@see GenericWorker).
 * It is intended to be the main class in its worker-process, and handles things like communication with the WorkForce or the Expectation-Manager
 */

export class WorkerAgent {
	private _worker: GenericWorker
	// private _busyMethodCount = 0
	private workforceAPI: WorkforceAPI
	private appContainerAPI: AppContainerAPI
	private wipI = 0
	private currentJobs: CurrentJob[] = []
	public readonly id: string
	private workForceConnectionOptions: ClientConnectionOptions
	private appContainerConnectionOptions: ClientConnectionOptions

	private expectationManagers: {
		[id: string]: {
			url: string
			api: ExpectationManagerAPI
		}
	} = {}
	private expectationManagerHooks: {
		[managerId: string]: Hook<
			ExpectationManagerWorkerAgent.ExpectationManager,
			ExpectationManagerWorkerAgent.WorkerAgent
		>
	} = {}
	private terminated = false
	private spinDownTime = 0
	private intervalCheckTimer: NodeJS.Timer | null = null
	private lastWorkTime = 0
	private activeMonitors: { [containerId: string]: { [monitorId: string]: MonitorInProgress } } = {}
	private initWorkForceAPIPromise?: { resolve: () => void; reject: (reason?: any) => void }
	private initAppContainerAPIPromise?: { resolve: () => void; reject: (reason?: any) => void }
	private cpuTracker = new CPUTracker()
	private logger: LoggerInstance

	constructor(logger: LoggerInstance, private config: WorkerConfig) {
		this.logger = logger.category('WorkerAgent')
		this.workforceAPI = new WorkforceAPI(this.logger)
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

		this.appContainerAPI = new AppContainerAPI(this.logger)
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

		this.id = config.worker.workerId
		this.workForceConnectionOptions = this.config.worker.workforceURL
			? {
					type: 'websocket',
					url: this.config.worker.workforceURL,
			  }
			: {
					type: 'internal',
			  }
		this.appContainerConnectionOptions = this.config.worker.appContainerURL
			? {
					type: 'websocket',
					url: this.config.worker.appContainerURL,
			  }
			: {
					type: 'internal',
			  }
		// Todo: Different types of workers:
		this._worker = new WindowsWorker(
			this.logger,
			{
				location: {
					// todo: tmp:
					localComputerId: this.config.worker.resourceId,
					localNetworkIds: this.config.worker.networkIds,
				},
				config: this.config.worker,
				workerStorageRead: async (dataId: string) => {
					return this.appContainerAPI.workerStorageRead(dataId)
				},
				workerStorageWrite: async (
					dataId: string,
					customTimeout: number | undefined,
					cb: (current: any | undefined) => Promise<any> | any
				) => {
					// First, aquire a lock to the data, so that noone else can read/write to it:
					const { lockId, current } = await this.appContainerAPI.workerStorageWriteLock(dataId, customTimeout)
					try {
						// Then, execute the callback:
						const writeData = await Promise.resolve(cb(current))
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

			async (managerId: string, message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any) => {
				// Forward the message to the expectationManager:

				const manager = this.expectationManagers[managerId]
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
		const pAppContainer = new Promise<void>((resolve, reject) => {
			this.initAppContainerAPIPromise = { resolve, reject }
		})
		await this.appContainerAPI.init(this.id, this.appContainerConnectionOptions, this)
		// Wait for this.appContainerAPI to be ready before continuing:
		await pAppContainer

		// Connect to WorkForce:
		if (this.workForceConnectionOptions.type === 'websocket') {
			this.logger.info(`Worker: Connecting to Workforce at "${this.workForceConnectionOptions.url}"`)
		}
		const pWorkForce = new Promise<void>((resolve, reject) => {
			this.initWorkForceAPIPromise = { resolve, reject }
		})
		await this.workforceAPI.init(this.id, this.workForceConnectionOptions, this)
		// Wait for this.workforceAPI to be ready before continuing:
		await pWorkForce

		this.IDidSomeWork()
	}
	terminate(): void {
		this.logger.info(`WorkerAgent.terminate: Terminating...`)

		this.terminated = true
		this.workforceAPI.terminate()

		for (const expectationManager of Object.values(this.expectationManagers)) {
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
		managerId: string,
		hook: Hook<ExpectationManagerWorkerAgent.ExpectationManager, ExpectationManagerWorkerAgent.WorkerAgent>
	): void {
		this.expectationManagerHooks[managerId] = hook
	}
	hookToAppContainer(hook: Hook<AppContainerWorkerAgent.AppContainer, AppContainerWorkerAgent.WorkerAgent>): void {
		this.appContainerAPI.hook(hook)
	}

	/** Keep track of the promise retorned by fcn and when it's resolved, to determine how busy we are */
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
	async doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		this.IDidSomeWork()
		return this._worker.doYouSupportExpectation(exp)
	}
	async doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportExpectation> {
		this.IDidSomeWork()
		return this._worker.doYouSupportPackageContainer(packageContainer)
	}
	async expectationManagerAvailable(id: string, url: string): Promise<void> {
		const existing = this.expectationManagers[id]
		if (existing) {
			existing.api.terminate()
		}

		await this.connectToExpectationManager(id, url)
	}
	async expectationManagerGone(id: string): Promise<void> {
		delete this.expectationManagers[id]
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

		for (const [containerId, monitors] of Object.entries(this.activeMonitors)) {
			for (const [monitorId, monitor] of Object.entries(monitors)) {
				activeMonitors.push({
					containerId,
					monitorId,
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
	public async setSpinDownTime(spinDownTime: number): Promise<void> {
		this.spinDownTime = spinDownTime
		this.IDidSomeWork()

		this.setupIntervalCheck()
	}
	private getStartCost(exp: Expectation.Any): { cost: number; jobCount: number } {
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

		return {
			cost:
				(this.currentJobs.reduce((sum, job) => sum + job.cost.cost * (1 - job.progress), 0) + systemStartCost) *
				workerMultiplier,
			jobCount: this.currentJobs.length,
		}
	}

	private async connectToExpectationManager(id: string, url: string): Promise<void> {
		this.logger.info(`Worker: Connecting to Expectation Manager "${id}" at url "${url}"`)
		const expectedManager = (this.expectationManagers[id] = {
			url: url,
			api: new ExpectationManagerAPI(this.logger),
		})
		expectedManager.api.on('disconnected', () => {
			this.logger.warn('Worker: ExpectationManager disconnected')
		})
		expectedManager.api.on('connected', () => {
			this.logger.info('Worker: ExpectationManager connected')
		})
		expectedManager.api.on('error', (err) => {
			this.logger.error(`WorkerAgent: ExpectationManagerAPI error event: ${stringifyError(err)}`)
		})
		const methods: ExpectationManagerWorkerAgent.WorkerAgent = literal<ExpectationManagerWorkerAgent.WorkerAgent>({
			doYouSupportExpectation: async (exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> => {
				return this._worker.doYouSupportExpectation(exp)
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
					cost: costForExpectation.cost * workerMultiplier,
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
			isExpectationFullfilled: async (
				exp: Expectation.Any,
				wasFullfilled: boolean
			): Promise<ReturnTypeIsExpectationFullfilled> => {
				this.IDidSomeWork()
				return this._worker.isExpectationFullfilled(exp, wasFullfilled)
			},
			workOnExpectation: async (
				exp: Expectation.Any,
				cost: ExpectationManagerWorkerAgent.ExpectationCost,
				/** Timeout, cancels the job if no updates are received in this time [ms] */
				timeout: number
			): Promise<ExpectationManagerWorkerAgent.WorkInProgressInfo> => {
				this.IDidSomeWork()

				// Tmp: we're only allowing one work per worker
				if (this.currentJobs.length > 0) {
					this.logger.warn(
						`workOnExpectation called, even though there are ${
							this.currentJobs.length
						} current jobs. Startcost now: ${this.getStartCost(exp).cost}, spcified cost=${
							cost.cost
						}, specified startCost=${cost.startCost}`
					)
				}

				const currentJob: CurrentJob = {
					cost: cost,
					cancelled: false,
					lastUpdated: Date.now(),
					progress: 0,
					wipId: this.wipI++,
					workInProgress: null,
					timeoutInterval: setInterval(() => {
						if (currentJob.cancelled && currentJob.timeoutInterval) {
							clearInterval(currentJob.timeoutInterval)
							currentJob.timeoutInterval = null
							return
						}

						if (Date.now() - currentJob.lastUpdated > timeout) {
							// The job seems to have timed out.
							// Expectation Manager will clean up on it's side, we have to do the same here.

							this.logger.warn(
								`WorkerAgent: Cancelling job "${currentJob.workInProgress?.properties.workLabel}" (${currentJob.wipId}) due to timeout (${timeout})`
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
									`WorkerAgent: timeout watch: Error in cancelJob (${
										currentJob.wipId
									}) ${stringifyError(error)}`
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
					const workInProgress = await this._worker.workOnExpectation(exp)

					currentJob.workInProgress = workInProgress

					workInProgress.on('progress', (actualVersionHash, progress: number) => {
						this.IDidSomeWork()
						if (currentJob.cancelled) return // Don't send updates on cancelled work
						currentJob.lastUpdated = Date.now()
						currentJob.progress = progress
						expectedManager.api
							.wipEventProgress(currentJob.wipId, actualVersionHash, progress)
							.catch((err) => {
								if (!this.terminated) {
									this.logger.error(`Error in wipEventProgress: ${stringifyError(err)}`)
								}
							})
					})
					workInProgress.on('error', (error: string) => {
						this.IDidSomeWork()
						if (currentJob.cancelled) return // Don't send updates on cancelled work
						currentJob.lastUpdated = Date.now()
						this.currentJobs = this.currentJobs.filter((job) => job !== currentJob)
						this.logger.warn(
							`Worker "${this.id}" stopped job ${currentJob.wipId}, (${exp.id}), due to error: (${
								this.currentJobs.length
							}): ${stringifyError(error)}`
						)

						expectedManager.api
							.wipEventError(currentJob.wipId, {
								user: 'Work aborted due to an error',
								tech: error,
							})
							.catch((err) => {
								if (!this.terminated) {
									this.logger.error(`Error in wipEventError: ${stringifyError(err)}`)
								}
							})

						this.removeJob(currentJob)
					})
					workInProgress.on('done', (actualVersionHash, reason, result) => {
						this.IDidSomeWork()
						if (currentJob.cancelled) return // Don't send updates on cancelled work
						currentJob.lastUpdated = Date.now()
						this.currentJobs = this.currentJobs.filter((job) => job !== currentJob)
						this.logger.debug(
							`Worker "${this.id}" stopped job ${currentJob.wipId}, (${exp.id}), done. (${this.currentJobs.length})`
						)

						expectedManager.api
							.wipEventDone(currentJob.wipId, actualVersionHash, reason, result)
							.catch((err) => {
								if (!this.terminated) {
									this.logger.error(`Error in wipEventDone: ${stringifyError(err)}`)
								}
							})
						this.removeJob(currentJob)
					})

					return {
						wipId: currentJob.wipId,
						properties: workInProgress.properties,
					}
				} catch (err) {
					// worker.workOnExpectation() failed.

					this.removeJob(currentJob)
					this.logger.warn(
						`Worker "${this.id}" stopped job ${currentJob.wipId}, (${exp.id}), due to initial error. (${this.currentJobs.length})`
					)

					throw err
				}
			},
			removeExpectation: async (exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> => {
				this.IDidSomeWork()
				return this._worker.removeExpectation(exp)
			},
			cancelWorkInProgress: async (wipId: number): Promise<void> => {
				this.IDidSomeWork()
				return this.cancelJob(wipId)
			},
			doYouSupportPackageContainer: (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeDoYouSupportPackageContainer> => {
				this.IDidSomeWork()
				return this._worker.doYouSupportPackageContainer(packageContainer)
			},
			runPackageContainerCronJob: (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeRunPackageContainerCronJob> => {
				this.IDidSomeWork()
				return this._worker.runPackageContainerCronJob(packageContainer)
			},
			setupPackageContainerMonitors: async (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeSetupPackageContainerMonitors> => {
				this.IDidSomeWork()
				if (!this.activeMonitors[packageContainer.id]) {
					this.activeMonitors[packageContainer.id] = {}
				}

				const result = await this._worker.setupPackageContainerMonitors(packageContainer)
				if (result.success) {
					const returnMonitors: { [monitorId: string]: MonitorProperties } = {}

					for (const [monitorId, monitorInProgress] of Object.entries(result.monitors)) {
						this.activeMonitors[packageContainer.id][monitorId] = monitorInProgress
						returnMonitors[monitorId] = monitorInProgress.properties

						monitorInProgress.on('error', (internalError: unknown) => {
							this.logger.error(
								`WorkerAgent.methods.setupPackageContainerMonitors: ${JSON.stringify(internalError)}`
							)
							expectedManager.api
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
							expectedManager.api
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
				packageContainerId: string
			): Promise<ReturnTypeDisposePackageContainerMonitors> => {
				this.IDidSomeWork()
				let errorReason: Reason | null = null

				const activeMonitors = this.activeMonitors[packageContainerId] || {}

				for (const [monitorId, monitor] of Object.entries(activeMonitors)) {
					try {
						await monitor.stop()
						delete this.activeMonitors[monitorId]
					} catch (err) {
						errorReason = {
							user: 'Unable to stop monitor',
							tech: `Error: ${stringifyError(err)}`,
						}
					}
				}
				if (!errorReason) return { success: true }
				else return { success: false, reason: errorReason }
			},
		})
		// Wrap the methods, so that we can cut off communication upon termination: (this is used in tests)
		for (const key of Object.keys(methods) as Array<keyof ExpectationManagerWorkerAgent.WorkerAgent>) {
			const fcn = methods[key] as any
			methods[key] = ((...args: any[]) => {
				if (this.terminated)
					return new Promise((_resolve, reject) => {
						// Simulate a timed out message:
						setTimeout(() => {
							reject('Timeout')
						}, 200)
					})
				return fcn(...args)
			}) as any
		}
		// Connect to the ExpectationManager:
		if (url === '__internal') {
			// This is used for an internal connection:
			const managerHookHook = this.expectationManagerHooks[id]

			if (!managerHookHook)
				throw new Error(
					`WorkerAgent.connectToExpectationManager: manager hook not found for manager "${id}", call hookToExpectationManager() first!`
				)
			expectedManager.api.hook(managerHookHook)
		}

		const connectionOptions: ClientConnectionOptions =
			url === '__internal' ? { type: 'internal' } : { type: 'websocket', url: expectedManager.url }

		await expectedManager.api.init(this.id, connectionOptions, methods)
	}

	private async updateListOfExpectationManagers(newExpectationManagers: { id: string; url: string }[]) {
		const ids: { [id: string]: true } = {}
		for (const newEm of newExpectationManagers) {
			ids[newEm.id] = true

			const em = this.expectationManagers[newEm.id]
			if (!em || em.url !== newEm.url) {
				// added or changed
				await this.expectationManagerAvailable(newEm.id, newEm.url)
			}
		}
		// Removed
		for (const id of Object.keys(this.expectationManagers)) {
			if (!ids[id]) {
				// removed
				await this.expectationManagerGone(id)
			}
		}
	}
	private async cancelJob(currentJobOrId: CurrentJob | number): Promise<void> {
		let wipId: number
		let currentJob: CurrentJob | undefined
		if (typeof currentJobOrId === 'number') {
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
				this.IDidSomeWork() // so that we won't ask again until later

				// Don's spin down if a monitor is active
				if (!Object.keys(this.activeMonitors).length) {
					this.logger.info(`Worker: is idle, requesting spinning down`)

					if (this.appContainerAPI.connected) {
						this.appContainerAPI.requestSpinDown().catch((err) => {
							this.logger.error(`Worker: appContainerAPI.requestSpinDown failed: ${stringifyError(err)}`)
						})
					} else {
						// Huh, we're not connected to the appContainer.
						// Well, we want to spin down anyway, so we'll do it:
						// eslint-disable-next-line no-process-exit
						process.exit(54)
					}
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
	private IDidSomeWork() {
		this.lastWorkTime = Date.now()
	}
}
interface CurrentJob {
	cost: ExpectationManagerWorkerAgent.ExpectationCost
	cancelled: boolean
	lastUpdated: number
	progress: number
	timeoutInterval: NodeJS.Timeout | null
	wipId: number
	workInProgress: IWorkInProgress | null
}
