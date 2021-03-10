import {
	ClientConnection,
	WebsocketServer,
	WorkForceExpectationManager,
	WorkForceWorkerAgent,
	Hook,
	LoggerInstance,
	WorkforceConfig,
} from '@shared/api'
import { ExpectationManagerAPI } from './expManApi'
import { WorkerAgentAPI } from './workerAgentApi'

export class Workforce {
	private workerAgents: {
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
	private websocketServer?: WebsocketServer

	constructor(private logger: LoggerInstance, config: WorkforceConfig) {
		if (config.workforce.port) {
			this.websocketServer = new WebsocketServer(config.workforce.port, (client: ClientConnection) => {
				// A new client has connected

				this.logger.info(`New ${client.clientType} connected, id "${client.clientId}"`)

				if (client.clientType === 'workerAgent') {
					const workForceMethods = this.getWorkerAgentAPI()
					const api = new WorkerAgentAPI(workForceMethods, {
						type: 'websocket',
						clientConnection: client,
					})
					this.workerAgents[client.clientId] = { api }
				} else if (client.clientType === 'expectationManager') {
					const workForceMethods = this.getExpectationManagerAPI()
					const api = new ExpectationManagerAPI(workForceMethods, {
						type: 'websocket',
						clientConnection: client,
					})
					this.expectationManagers[client.clientId] = { api }
				} else {
					throw new Error(`Unknown clientType "${client.clientType}"`)
				}
			})
		}
	}

	async init(): Promise<void> {
		// Nothing to do here at the moment
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
			registerExpectationManager: async (managerId: string, url: string): Promise<void> => {
				await this.registerExpectationManager(managerId, url)
			},
		}
	}

	public async registerExpectationManager(managerId: string, url: string): Promise<void> {
		const em = this.expectationManagers[managerId]
		if (!em || em.url !== url) {
			// Added/Changed

			// Announce the new expectation manager to the workerAgents:
			for (const workerAgent of Object.values(this.workerAgents)) {
				await workerAgent.api.expectationManagerAvailable(managerId, url)
			}
		}
		this.expectationManagers[managerId].url = url
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
}
