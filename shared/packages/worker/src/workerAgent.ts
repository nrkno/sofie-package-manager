import {
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
} from '@shared/api'
import { AppContainerAPI } from './appContainerApi'
import { ExpectationManagerAPI } from './expectationManagerApi'
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
	private currentJobs: { cost: ExpectationManagerWorkerAgent.ExpectationCost; progress: number }[] = []
	private workforceAPI: WorkforceAPI
	private appContainerAPI: AppContainerAPI
	private wipI = 0

	private worksInProgress: { [wipId: string]: IWorkInProgress } = {}
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

	constructor(private logger: LoggerInstance, private config: WorkerConfig) {
		this.workforceAPI = new WorkforceAPI(this.logger)
		this.appContainerAPI = new AppContainerAPI(this.logger)

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

		// Connect to AppContainer (if applicable)
		if (this.appContainerConnectionOptions) {
			if (this.appContainerConnectionOptions.type === 'websocket') {
				this.logger.info(`Worker: Connecting to AppContainer at "${this.appContainerConnectionOptions.url}"`)
			}
			await this.appContainerAPI.init(this.id, this.appContainerConnectionOptions, this)
		}

		const list = await this.workforceAPI.getExpectationManagerList()
		await this.updateListOfExpectationManagers(list)

	}
	terminate(): void {
		this.terminated = true
		this.workforceAPI.terminate()
		Object.values(this.expectationManagers).forEach((expectationManager) => expectationManager.api.terminate())
		// this._worker.terminate()
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
		return this._worker.doYouSupportExpectation(exp)
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
		this.logger.level = logLevel
	}
	async _debugKill(): Promise<void> {
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}

	private async connectToExpectationManager(id: string, url: string): Promise<void> {
		this.logger.info(`Worker: Connecting to Expectation Manager "${id}" at url "${url}"`)
		const expectedManager = (this.expectationManagers[id] = {
			url: url,
			api: new ExpectationManagerAPI(this.logger),
		})
		const methods: ExpectationManagerWorkerAgent.WorkerAgent = literal<ExpectationManagerWorkerAgent.WorkerAgent>({
			doYouSupportExpectation: async (exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> => {
				return this._worker.doYouSupportExpectation(exp)
			},
			getCostForExpectation: async (
				exp: Expectation.Any
			): Promise<ExpectationManagerWorkerAgent.ExpectationCost> => {
				const cost = await this._worker.getCostFortExpectation(exp)

				return {
					cost: cost,
					startCost: this.currentJobs.reduce((sum, job) => sum + job.cost.cost * (1 - job.progress), 0),
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
				return this._worker.isExpectationFullfilled(exp, wasFullfilled)
			},
			workOnExpectation: async (
				exp: Expectation.Any,
				cost: ExpectationManagerWorkerAgent.ExpectationCost
			): Promise<ExpectationManagerWorkerAgent.WorkInProgressInfo> => {
				const currentjob = {
					cost: cost,
					progress: 0,
					// callbacksOnDone: [],
				}
				const wipId = this.wipI++
				this.logger.debug(
					`Worker "${this.id}" starting job ${wipId}, (${exp.id}). (${this.currentJobs.length})`
				)
				this.currentJobs.push(currentjob)

				try {
					const workInProgress = await this._worker.workOnExpectation(exp)

					this.worksInProgress[`${wipId}`] = workInProgress

					workInProgress.on('progress', (actualVersionHash, progress: number) => {
						currentjob.progress = progress
						expectedManager.api.wipEventProgress(wipId, actualVersionHash, progress).catch((err) => {
							if (!this.terminated) {
								this.logger.error('Error in wipEventProgress')
								this.logger.error(err)
							}
						})
					})
					workInProgress.on('error', (error: string) => {
						this.currentJobs = this.currentJobs.filter((job) => job !== currentjob)
						this.logger.debug(
							`Worker "${this.id}" stopped job ${wipId}, (${exp.id}), due to error. (${this.currentJobs.length})`
						)

						expectedManager.api
							.wipEventError(wipId, {
								user: 'Work aborted due to an error',
								tech: error,
							})
							.catch((err) => {
								if (!this.terminated) {
									this.logger.error('Error in wipEventError')
									this.logger.error(err)
								}
							})
						delete this.worksInProgress[`${wipId}`]
					})
					workInProgress.on('done', (actualVersionHash, reason, result) => {
						this.currentJobs = this.currentJobs.filter((job) => job !== currentjob)
						this.logger.debug(
							`Worker "${this.id}" stopped job ${wipId}, (${exp.id}), done. (${this.currentJobs.length})`
						)

						expectedManager.api.wipEventDone(wipId, actualVersionHash, reason, result).catch((err) => {
							if (!this.terminated) {
								this.logger.error('Error in wipEventDone')
								this.logger.error(err)
							}
						})
						delete this.worksInProgress[`${wipId}`]
					})

					return {
						wipId: wipId,
						properties: workInProgress.properties,
					}
				} catch (err) {
					// The workOnExpectation failed.

					this.currentJobs = this.currentJobs.filter((job) => job !== currentjob)
					this.logger.debug(
						`Worker "${this.id}" stopped job ${wipId}, (${exp.id}), due to initial error. (${this.currentJobs.length})`
					)

					throw err
				}
			},
			removeExpectation: async (exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> => {
				return this._worker.removeExpectation(exp)
			},
			cancelWorkInProgress: async (wipId: number): Promise<void> => {
				const wip = this.worksInProgress[`${wipId}`]
				if (wip) {
					await wip.cancel()
				}
				delete this.worksInProgress[`${wipId}`]
			},
			doYouSupportPackageContainer: (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeDoYouSupportPackageContainer> => {
				return this._worker.doYouSupportPackageContainer(packageContainer)
			},
			runPackageContainerCronJob: (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeRunPackageContainerCronJob> => {
				return this._worker.runPackageContainerCronJob(packageContainer)
			},
			setupPackageContainerMonitors: (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeSetupPackageContainerMonitors> => {
				return this._worker.setupPackageContainerMonitors(packageContainer)
			},
			disposePackageContainerMonitors: (
				packageContainer: PackageContainerExpectation
			): Promise<ReturnTypeDisposePackageContainerMonitors> => {
				return this._worker.disposePackageContainerMonitors(packageContainer)
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
}
