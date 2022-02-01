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
} from '@shared/api'

import { AppContainerAPI } from './appContainerApi'
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
	private appContainerConnectionOptions: ClientConnectionOptions | null

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

	constructor(private logger: LoggerInstance, private config: WorkerConfig) {
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
			: null
		// Todo: Different types of workers:
		this._worker = new WindowsWorker(
			this.logger,
			this.config.worker,
			async (managerId: string, message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any) => {
				// Forward the message to the expectationManager:

				const manager = this.expectationManagers[managerId]
				if (!manager) throw new Error(`ExpectationManager "${managerId}" not found`)

				return manager.api.messageFromWorker(message)
			},
			{
				// todo: tmp:
				localComputerId: this.config.worker.resourceId,
				localNetworkIds: this.config.worker.networkIds,
			}
		)
	}
	async init(): Promise<void> {
		await this._worker.init()

		// Connect to WorkForce:
		if (this.workForceConnectionOptions.type === 'websocket') {
			this.logger.info(`Worker: Connecting to Workforce at "${this.workForceConnectionOptions.url}"`)
		}
		await this.workforceAPI.init(this.id, this.workForceConnectionOptions, this)
		// Wait for this.workforceAPI to be ready before continuing:
		await new Promise<void>((resolve, reject) => {
			this.initWorkForceAPIPromise = { resolve, reject }
		})

		// Connect to AppContainer (if applicable)
		if (this.appContainerConnectionOptions) {
			if (this.appContainerConnectionOptions.type === 'websocket') {
				this.logger.info(`Worker: Connecting to AppContainer at "${this.appContainerConnectionOptions.url}"`)
			}
			await this.appContainerAPI.init(this.id, this.appContainerConnectionOptions, this)
			// Wait for this.appContainerAPI to be ready before continuing:
			await new Promise<void>((resolve, reject) => {
				this.initAppContainerAPIPromise = { resolve, reject }
			})
		}

		this.IDidSomeWork()
	}
	terminate(): void {
		this.terminated = true
		this.workforceAPI.terminate()

		for (const expectationManager of Object.values(this.expectationManagers)) {
			expectationManager.api.terminate()
		}
		for (const currentJob of this.currentJobs) {
			if (currentJob.wipId) {
				this.cancelJob(currentJob.wipId).catch((error) => {
					this.logger.error(`WorkerAgent.terminate: Error in cancelJob: ${stringifyError(error)}`)
				})
			}
		}
		if (this.intervalCheckTimer) clearInterval(this.intervalCheckTimer)
		this._worker.terminate()
	}
	/** Called when running in the same-process-mode, it */
	hookToWorkforce(hook: Hook<WorkForceWorkerAgent.WorkForce, WorkForceWorkerAgent.WorkerAgent>): void {
		this.workforceAPI.hook(hook)
	}
	hookToExpectationManager(
		managerId: string,
		hook: Hook<ExpectationManagerWorkerAgent.ExpectationManager, ExpectationManagerWorkerAgent.WorkerAgent>
	): void {
		this.expectationManagerHooks[managerId] = hook
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
		this.logger.setLogLevel(logLevel)
	}
	async _debugKill(): Promise<void> {
		this.terminate()
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}
	public async setSpinDownTime(spinDownTime: number): Promise<void> {
		this.spinDownTime = spinDownTime
		this.IDidSomeWork()

		this.setupIntervalCheck()
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
				const cost = await this._worker.getCostFortExpectation(exp)

				const workerMultiplier: number = this.config.worker.costMultiplier || 1

				return {
					cost: cost * workerMultiplier,
					startCost:
						this.currentJobs.reduce((sum, job) => sum + job.cost.cost * (1 - job.progress), 0) *
						workerMultiplier,
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
								this.cancelJob(currentJob.wipId),
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
							`Worker "${this.id}" stopped job ${currentJob.wipId}, (${exp.id}), due to error. (${this.currentJobs.length})`
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
							expectedManager.api
								.monitorStatus(packageContainer.id, monitorId, StatusCode.FATAL, {
									user: 'Internal Error',
									tech: stringifyError(internalError),
								})
								.catch((err) => {
									if (!this.terminated) {
										this.logger.error(`Error in monitorStatus: ${stringifyError(err)}`)
									}
								})
						})
						monitorInProgress.on('status', (status: StatusCode, reason: Reason) => {
							expectedManager.api
								.monitorStatus(packageContainer.id, monitorId, status, reason)
								.catch((err) => {
									if (!this.terminated) {
										this.logger.error(`Error in monitorStatus: ${stringifyError(err)}`)
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
	private async cancelJob(wipId: number): Promise<void> {
		const currentJob = this.currentJobs.find((job) => job.wipId === wipId)

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
