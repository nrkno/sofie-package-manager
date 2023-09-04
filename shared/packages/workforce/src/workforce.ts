import {
	ClientConnection,
	WebsocketServer,
	WorkForceExpectationManager,
	WorkForceWorkerAgent,
	Hook,
	LoggerInstance,
	WorkforceConfig,
	assertNever,
	WorkForceAppContainer,
	WorkforceStatusReport,
	LogLevel,
	Expectation,
	PackageContainerExpectation,
	stringifyError,
	hashObj,
	Statuses,
	StatusCode,
	setLogLevel,
	mapEntries,
	ExpectationManagerId,
	AppContainerId,
	WorkerAgentId,
	WORKFORCE_ID,
	AppType,
	AppId,
	AnyProtectedString,
} from '@sofie-package-manager/api'
import { AppContainerAPI } from './appContainerApi'
import { ExpectationManagerAPI } from './expectationManagerApi'
import { WorkerAgentAPI } from './workerAgentApi'
import { WorkerHandler } from './workerHandler'

/**
 * The Workforce class tracks the status of which ExpectationManagers and WorkerAgents are online,
 * and mediates connections between the two.
 */
export class Workforce {
	public workerAgents: Map<
		WorkerAgentId,
		{
			api: WorkerAgentAPI
		}
	> = new Map()

	private expectationManagers: Map<
		ExpectationManagerId,
		{
			api: ExpectationManagerAPI
			url?: string
		}
	> = new Map()
	public appContainers: Map<
		AppContainerId,
		{
			api: AppContainerAPI
			initialized: boolean
			runningApps: {
				appId: AppId
				appType: AppType
			}[]
			availableApps: {
				appType: AppType
			}[]
		}
	> = new Map()
	private websocketServer?: WebsocketServer

	private workerHandler: WorkerHandler
	private _reportedStatuses: Map<ExpectationManagerId, string> = new Map() // contains hash of status

	private evaluateStatusTimeout: NodeJS.Timeout | null = null

	private logger: LoggerInstance
	private id = WORKFORCE_ID // Since there only ever is one workforce, this is hardcoded

	constructor(logger: LoggerInstance, config: WorkforceConfig) {
		this.logger = logger.category('Workforce')
		if (config.workforce.port !== null) {
			this.websocketServer = new WebsocketServer(
				config.workforce.port,
				this.logger,
				(client: ClientConnection) => {
					// A new client has connected

					this.logger.info(`Workforce: New client "${client.clientType}" connected, id "${client.clientId}"`)

					switch (client.clientType) {
						case 'workerAgent': {
							const clientId = client.clientId as WorkerAgentId
							const workForceMethods = this.getWorkerAgentAPI(clientId)
							const api = new WorkerAgentAPI(this.id, workForceMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							this.workerAgents.set(clientId, { api })
							client.once('close', () => {
								this.logger.warn(`Workforce: Connection to Worker "${clientId}" closed`)
								this.workerAgents.delete(clientId)
								this.triggerEvaluateStatus()
							})
							this.logger.info(`Workforce: Connection to Worker "${clientId}" established`)
							this.triggerEvaluateStatus()
							break
						}
						case 'expectationManager': {
							const clientId = client.clientId as ExpectationManagerId
							const workForceMethods = this.getExpectationManagerAPI(clientId)
							const api = new ExpectationManagerAPI(this.id, workForceMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							this.expectationManagers.set(clientId, { api })
							client.once('close', () => {
								this.logger.warn(`Workforce: Connection to ExpectationManager "${clientId}" closed`)
								this.triggerEvaluateStatus()
								this.expectationManagers.delete(clientId)
							})
							this.logger.info(`Workforce: Connection to ExpectationManager "${clientId}" established`)
							this.triggerEvaluateStatus()
							break
						}
						case 'appContainer': {
							const clientId = client.clientId as AppContainerId
							const workForceMethods = this.getAppContainerAPI(clientId)
							const api = new AppContainerAPI(this.id, workForceMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							this.appContainers.set(clientId, {
								api,
								availableApps: [],
								runningApps: [],
								initialized: false,
							})
							client.once('close', () => {
								this.logger.warn(`Workforce: Connection to AppContainer "${clientId}" closed`)
								this.appContainers.delete(clientId)
								this.triggerEvaluateStatus()
							})
							this.logger.info(`Workforce: Connection to AppContainer "${clientId}" established`)
							this.triggerEvaluateStatus()
							break
						}

						case 'N/A':
							throw new Error(`ExpectationManager: Unsupported clientType "${client.clientType}"`)
						default:
							assertNever(client.clientType)
							throw new Error(`Workforce: Unknown clientType "${client.clientType}"`)
					}
				}
			)

			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`Workforce: WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`Workforce: WebsocketServer closed`)
			})
		}
		this.workerHandler = new WorkerHandler(this.logger, this)
	}

	async init(): Promise<void> {
		// Nothing to do here at the moment
		// this.workerHandler.triggerUpdate()
	}
	terminate(): void {
		this.websocketServer?.terminate()
	}
	/** Returns a Hook used to hook up a WorkerAgent to our API-methods. */
	getWorkerAgentHook(): Hook<WorkForceWorkerAgent.WorkForce, WorkForceWorkerAgent.WorkerAgent> {
		return (clientId: WorkerAgentId, clientMethods) => {
			// On connection from a workerAgent

			const workForceMethods = this.getWorkerAgentAPI(clientId)
			const api = new WorkerAgentAPI(this.id, workForceMethods, {
				type: 'internal',
				hookMethods: clientMethods,
			})
			this.workerAgents.set(clientId, { api })

			return workForceMethods
		}
	}
	getExpectationManagerHook(): Hook<
		WorkForceExpectationManager.WorkForce,
		WorkForceExpectationManager.ExpectationManager
	> {
		return (clientId: ExpectationManagerId, clientMethods) => {
			// On connection from an ExpectationManager

			const workForceMethods = this.getExpectationManagerAPI(clientId)
			const api = new ExpectationManagerAPI(this.id, workForceMethods, {
				type: 'internal',
				hookMethods: clientMethods,
			})
			this.expectationManagers.set(clientId, { api })

			return workForceMethods
		}
	}
	getPort(): number | undefined {
		return this.websocketServer?.port
	}
	triggerEvaluateStatus(): void {
		if (!this.evaluateStatusTimeout) {
			this.evaluateStatusTimeout = setTimeout(() => {
				this.evaluateStatusTimeout = null
				this.evaluateStatus()
			}, 500)
		}
	}
	evaluateStatus(): void {
		const statuses: Statuses = {}

		statuses['any-workers'] =
			this.workerAgents.size === 0
				? {
						statusCode: StatusCode.BAD,
						message: 'No workers connected to workforce',
				  }
				: {
						statusCode: StatusCode.GOOD,
						message: '',
				  }

		statuses['any-appContainers'] =
			this.appContainers.size === 0
				? {
						statusCode: StatusCode.BAD,
						message: 'No appContainers connected to workforce',
				  }
				: {
						statusCode: StatusCode.GOOD,
						message: '',
				  }

		const statusHash = hashObj(statuses)

		// Report our status to each connected expectationManager:
		for (const [id, expectationManager] of this.expectationManagers.entries()) {
			if (this._reportedStatuses.get(id) !== statusHash) {
				this._reportedStatuses.set(id, statusHash)

				expectationManager.api
					.onWorkForceStatus(statuses)
					.catch((e) => this.logger.error(`Error in onWorkForceStatus: ${stringifyError(e)}`))
			}
		}
	}

	/** Return the API-methods that the Workforce exposes to the WorkerAgent */
	private getWorkerAgentAPI(clientId: WorkerAgentId): WorkForceWorkerAgent.WorkForce {
		return {
			id: clientId,

			getExpectationManagerList: async (): Promise<{ id: ExpectationManagerId; url: string }[]> => {
				const list: { id: ExpectationManagerId; url: string }[] = []

				for (const [id, entry] of this.expectationManagers.entries()) {
					if (entry.url) {
						list.push({
							id: id,
							url: entry.url,
						})
					}
				}
				return list
			},
		}
	}
	/** Return the API-methods that the Workforce exposes to the ExpectationManager */
	private getExpectationManagerAPI(clientId: ExpectationManagerId): WorkForceExpectationManager.WorkForce {
		return {
			id: clientId,

			setLogLevel: async (logLevel: LogLevel): Promise<void> => {
				return this.setLogLevel(logLevel)
			},
			setLogLevelOfApp: async (appId: AnyProtectedString, logLevel: LogLevel): Promise<void> => {
				return this.setLogLevelOfApp(appId, logLevel)
			},
			registerExpectationManager: async (managerId: ExpectationManagerId, url: string): Promise<void> => {
				await this.registerExpectationManager(managerId, url)
			},
			requestResourcesForExpectation: async (exp: Expectation.Any): Promise<boolean> => {
				return this.requestResourcesForExpectation(exp)
			},
			requestResourcesForPackageContainer: async (
				packageContainer: PackageContainerExpectation
			): Promise<boolean> => {
				return this.requestResourcesForPackageContainer(packageContainer)
			},

			getStatusReport: async (): Promise<WorkforceStatusReport> => {
				return this.getStatusReport()
			},
			_debugKillApp: async (appId: AnyProtectedString): Promise<void> => {
				return this._debugKillApp(appId)
			},
			_debugSendKillConnections: async (): Promise<void> => {
				return this._debugSendKillConnections()
			},
		}
	}
	/** Return the API-methods that the Workforce exposes to the AppContainer */
	private getAppContainerAPI(clientId: AppContainerId): WorkForceAppContainer.WorkForce {
		return {
			id: clientId,
			registerAvailableApps: async (availableApps: { appType: AppType }[]): Promise<void> => {
				await this.registerAvailableApps(clientId, availableApps)
			},
		}
	}
	private _debugKill(): void {
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}

	public async registerExpectationManager(managerId: ExpectationManagerId, url: string): Promise<void> {
		let em = this.expectationManagers.get(managerId)
		if (!em || em.url !== url) {
			// Added/Changed

			this.logger.info(`Workforce: Register ExpectationManager (${managerId}) at url "${url}"`)

			// Announce the new expectation manager to the workerAgents:
			for (const workerAgent of this.workerAgents.values()) {
				await workerAgent.api.expectationManagerAvailable(managerId, url)
			}
			em = this.expectationManagers.get(managerId)
		}
		if (!em) {
			throw new Error(`Internal Error: (registerExpectationManager) ExpectationManager "${managerId}" not found!`)
		}
		em.url = url
	}
	public async requestResourcesForExpectation(exp: Expectation.Any): Promise<boolean> {
		return this.workerHandler.requestResourcesForExpectation(exp)
	}
	public async requestResourcesForPackageContainer(packageContainer: PackageContainerExpectation): Promise<boolean> {
		return this.workerHandler.requestResourcesForPackageContainer(packageContainer)
	}
	public async getStatusReport(): Promise<WorkforceStatusReport> {
		return {
			workerAgents: await Promise.all(
				mapEntries(this.workerAgents, async (_, workerAgent) => workerAgent.api.getStatusReport())
			),
			expectationManagers: mapEntries(this.expectationManagers, (id, expMan) => {
				return {
					id: id,
					url: expMan.url,
				}
			}),
			appContainers: mapEntries(this.appContainers, (id, appContainer) => {
				return {
					id: id,
					initialized: appContainer.initialized,
					availableApps: appContainer.availableApps.map((availableApp) => {
						return {
							appType: availableApp.appType,
						}
					}),
				}
			}),
		}
	}

	public setLogLevel(logLevel: LogLevel): void {
		setLogLevel(logLevel)
	}
	public async setLogLevelOfApp(appId: AnyProtectedString, logLevel: LogLevel): Promise<void> {
		const workerAgent = this.workerAgents.get(appId as WorkerAgentId)
		if (workerAgent) return workerAgent.api.setLogLevel(logLevel)

		const appContainer = this.appContainers.get(appId as AppContainerId)
		if (appContainer) return appContainer.api.setLogLevel(logLevel)

		const expectationManager = this.expectationManagers.get(appId as ExpectationManagerId)
		if (expectationManager) return expectationManager.api.setLogLevel(logLevel)

		if (appId === this.id) return this.setLogLevel(logLevel)
		throw new Error(`App with id "${appId}" not found`)
	}
	public async _debugKillApp(appId: AnyProtectedString): Promise<void> {
		const workerAgent = this.workerAgents.get(appId as WorkerAgentId)
		if (workerAgent) return workerAgent.api._debugKill()

		const appContainer = this.appContainers.get(appId as AppContainerId)
		if (appContainer) return appContainer.api._debugKill()

		const expectationManager = this.expectationManagers.get(appId as ExpectationManagerId)
		if (expectationManager) return expectationManager.api._debugKill()

		if (appId === this.id) return this._debugKill()
		throw new Error(`App with id "${appId}" not found`)
	}
	public async _debugSendKillConnections(): Promise<void> {
		for (const workerAgent of this.workerAgents.values()) {
			await workerAgent.api._debugSendKillConnections()
		}

		for (const appContainer of this.appContainers.values()) {
			await appContainer.api._debugSendKillConnections()
		}

		for (const expectationManager of this.expectationManagers.values()) {
			await expectationManager.api._debugSendKillConnections()
		}
	}

	public async removeExpectationManager(managerId: ExpectationManagerId): Promise<void> {
		const em = this.expectationManagers.get(managerId)
		if (em) {
			// Removed
			// Announce the expectation manager removal to the workerAgents:
			for (const workerAgent of this.workerAgents.values()) {
				await workerAgent.api.expectationManagerGone(managerId)
			}
		}
	}
	public async registerAvailableApps(clientId: AppContainerId, availableApps: { appType: AppType }[]): Promise<void> {
		const appContainer = this.appContainers.get(clientId)
		if (!appContainer) {
			throw new Error(`Internal Error: (registerAvailableApps) AppContainer "${clientId}" not found!`)
		}
		appContainer.availableApps = availableApps

		// Ask the AppContainer for a list of its running apps:
		appContainer.api
			.getRunningApps()
			.then((runningApps) => {
				appContainer.runningApps = runningApps
				appContainer.initialized = true
				// this.workerHandler.triggerUpdate()
			})
			.catch((error) => {
				this.logger.error(`Workforce: Error in getRunningApps: ${stringifyError(error)}`)
			})
	}
}
