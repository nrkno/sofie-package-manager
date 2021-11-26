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
	WorkforceStatus,
	LogLevel,
	Expectation,
	PackageContainerExpectation,
	stringifyError,
} from '@shared/api'
import { AppContainerAPI } from './appContainerApi'
import { ExpectationManagerAPI } from './expectationManagerApi'
import { WorkerAgentAPI } from './workerAgentApi'
import { WorkerHandler } from './workerHandler'

/**
 * The Workforce class tracks the status of which ExpectationManagers and WorkerAgents are online,
 * and mediates connections between the two.
 */
export class Workforce {
	public workerAgents: {
		[workerId: string]: {
			api: WorkerAgentAPI
		}
	} = {}

	private expectationManagers: {
		[id: string]: {
			api: ExpectationManagerAPI
			url?: string
		}
	} = {}
	public appContainers: {
		[id: string]: {
			api: AppContainerAPI
			initialized: boolean
			runningApps: {
				appId: string
				appType: string
			}[]
			availableApps: {
				appType: string
			}[]
		}
	} = {}
	private websocketServer?: WebsocketServer

	private workerHandler: WorkerHandler

	constructor(public logger: LoggerInstance, config: WorkforceConfig) {
		if (config.workforce.port !== null) {
			this.websocketServer = new WebsocketServer(config.workforce.port, (client: ClientConnection) => {
				// A new client has connected

				this.logger.info(`Workforce: New client "${client.clientType}" connected, id "${client.clientId}"`)

				switch (client.clientType) {
					case 'workerAgent': {
						const workForceMethods = this.getWorkerAgentAPI()
						const api = new WorkerAgentAPI(workForceMethods, {
							type: 'websocket',
							clientConnection: client,
						})
						this.workerAgents[client.clientId] = { api }
						client.once('close', () => {
							this.logger.warn(`Workforce: Connection to Worker "${client.clientId}" closed`)
							delete this.workerAgents[client.clientId]
						})
						this.logger.info(`Workforce: Connection to Worker "${client.clientId}" established`)
						break
					}
					case 'expectationManager': {
						const workForceMethods = this.getExpectationManagerAPI()
						const api = new ExpectationManagerAPI(workForceMethods, {
							type: 'websocket',
							clientConnection: client,
						})
						this.expectationManagers[client.clientId] = { api }
						client.once('close', () => {
							this.logger.warn(`Workforce: Connection to ExpectationManager "${client.clientId}" closed`)
							delete this.expectationManagers[client.clientId]
						})
						this.logger.info(`Workforce: Connection to ExpectationManager "${client.clientId}" established`)
						break
					}
					case 'appContainer': {
						const workForceMethods = this.getAppContainerAPI(client.clientId)
						const api = new AppContainerAPI(workForceMethods, {
							type: 'websocket',
							clientConnection: client,
						})
						this.appContainers[client.clientId] = {
							api,
							availableApps: [],
							runningApps: [],
							initialized: false,
						}
						client.once('close', () => {
							this.logger.warn(`Workforce: Connection to AppContainer "${client.clientId}" closed`)
							delete this.appContainers[client.clientId]
						})
						this.logger.info(`Workforce: Connection to AppContainer "${client.clientId}" established`)
						break
					}

					case 'N/A':
						throw new Error(`ExpectationManager: Unsupported clientType "${client.clientType}"`)
					default:
						assertNever(client.clientType)
						throw new Error(`Workforce: Unknown clientType "${client.clientType}"`)
				}
			})
			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`Workforce: WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`Workforce: WebsocketServer closed`)
			})
		}
		this.workerHandler = new WorkerHandler(this)
	}

	async init(): Promise<void> {
		// Nothing to do here at the moment
		// this.workerHandler.triggerUpdate()
	}
	terminate(): void {
		this.websocketServer?.terminate()
	}
	getWorkerAgentHook(): Hook<WorkForceWorkerAgent.WorkForce, WorkForceWorkerAgent.WorkerAgent> {
		return (clientId: string, clientMethods: WorkForceWorkerAgent.WorkerAgent) => {
			// On connection from a workerAgent

			const workerAgentMethods = this.getWorkerAgentAPI()
			const api = new WorkerAgentAPI(workerAgentMethods, {
				type: 'internal',
				hookMethods: clientMethods,
			})
			this.workerAgents[clientId] = { api }

			return workerAgentMethods
		}
	}
	getExpectationManagerHook(): Hook<
		WorkForceExpectationManager.WorkForce,
		WorkForceExpectationManager.ExpectationManager
	> {
		return (clientId: string, clientMethods: WorkForceExpectationManager.ExpectationManager) => {
			// On connection from an ExpectationManager

			const workForceMethods = this.getExpectationManagerAPI()
			const api = new ExpectationManagerAPI(workForceMethods, {
				type: 'internal',
				hookMethods: clientMethods,
			})
			this.expectationManagers[clientId] = { api }

			return workForceMethods
		}
	}
	getPort(): number | undefined {
		return this.websocketServer?.port
	}

	/** Return the API-methods that the Workforce exposes to the WorkerAgent */
	private getWorkerAgentAPI(): WorkForceWorkerAgent.WorkForce {
		return {
			getExpectationManagerList: async (): Promise<{ id: string; url: string }[]> => {
				const list: { id: string; url: string }[] = []

				for (const [id, entry] of Object.entries(this.expectationManagers)) {
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
	private getExpectationManagerAPI(): WorkForceExpectationManager.WorkForce {
		return {
			setLogLevel: async (logLevel: LogLevel): Promise<void> => {
				return this.setLogLevel(logLevel)
			},
			setLogLevelOfApp: async (appId: string, logLevel: LogLevel): Promise<void> => {
				return this.setLogLevelOfApp(appId, logLevel)
			},
			registerExpectationManager: async (managerId: string, url: string): Promise<void> => {
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

			getStatus: async (): Promise<WorkforceStatus> => {
				return this.getStatus()
			},
			_debugKillApp: async (appId: string): Promise<void> => {
				return this._debugKillApp(appId)
			},
		}
	}
	/** Return the API-methods that the Workforce exposes to the AppContainer */
	private getAppContainerAPI(clientId: string): WorkForceAppContainer.WorkForce {
		return {
			registerAvailableApps: async (availableApps: { appType: string }[]): Promise<void> => {
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

	public async registerExpectationManager(managerId: string, url: string): Promise<void> {
		const em = this.expectationManagers[managerId]
		if (!em || em.url !== url) {
			// Added/Changed

			this.logger.info(`Workforce: Register ExpectationManager (${managerId}) at url "${url}"`)

			// Announce the new expectation manager to the workerAgents:
			for (const workerAgent of Object.values(this.workerAgents)) {
				await workerAgent.api.expectationManagerAvailable(managerId, url)
			}
		}
		this.expectationManagers[managerId].url = url
	}
	public async requestResourcesForExpectation(exp: Expectation.Any): Promise<boolean> {
		return this.workerHandler.requestResourcesForExpectation(exp)
	}
	public async requestResourcesForPackageContainer(packageContainer: PackageContainerExpectation): Promise<boolean> {
		return this.workerHandler.requestResourcesForPackageContainer(packageContainer)
	}
	public async getStatus(): Promise<WorkforceStatus> {
		return {
			workerAgents: Object.entries(this.workerAgents).map(([workerId, _workerAgent]) => {
				return {
					id: workerId,
				}
			}),
			expectationManagers: Object.entries(this.expectationManagers).map(([id, expMan]) => {
				return {
					id: id,
					url: expMan.url,
				}
			}),
			appContainers: Object.entries(this.appContainers).map(([id, appContainer]) => {
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
		this.logger.level = logLevel
	}
	public async setLogLevelOfApp(appId: string, logLevel: LogLevel): Promise<void> {
		const workerAgent = this.workerAgents[appId]
		if (workerAgent) return workerAgent.api.setLogLevel(logLevel)

		const appContainer = this.appContainers[appId]
		if (appContainer) return appContainer.api.setLogLevel(logLevel)

		const expectationManager = this.expectationManagers[appId]
		if (expectationManager) return expectationManager.api.setLogLevel(logLevel)

		if (appId === 'workforce') return this.setLogLevel(logLevel)
		throw new Error(`App with id "${appId}" not found`)
	}
	public async _debugKillApp(appId: string): Promise<void> {
		const workerAgent = this.workerAgents[appId]
		if (workerAgent) return workerAgent.api._debugKill()

		const appContainer = this.appContainers[appId]
		if (appContainer) return appContainer.api._debugKill()

		const expectationManager = this.expectationManagers[appId]
		if (expectationManager) return expectationManager.api._debugKill()

		if (appId === 'workforce') return this._debugKill()
		throw new Error(`App with id "${appId}" not found`)
	}

	public async removeExpectationManager(managerId: string): Promise<void> {
		const em = this.expectationManagers[managerId]
		if (em) {
			// Removed
			// Announce the expectation manager removal to the workerAgents:
			for (const workerAgent of Object.values(this.workerAgents)) {
				await workerAgent.api.expectationManagerGone(managerId)
			}
		}
	}
	public async registerAvailableApps(clientId: string, availableApps: { appType: string }[]): Promise<void> {
		this.appContainers[clientId].availableApps = availableApps

		// Ask the AppContainer for a list of its running apps:
		this.appContainers[clientId].api
			.getRunningApps()
			.then((runningApps) => {
				this.appContainers[clientId].runningApps = runningApps
				this.appContainers[clientId].initialized = true
				// this.workerHandler.triggerUpdate()
			})
			.catch((error) => {
				this.logger.error(`Workforce: Error in getRunningApps: ${stringifyError(error)}`)
			})
	}
}
