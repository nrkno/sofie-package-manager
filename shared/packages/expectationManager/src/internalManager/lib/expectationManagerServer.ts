import {
	assertNever,
	ClientConnection,
	ClientConnectionOptions,
	LoggerInstance,
	StatusCode,
	stringifyError,
	WebsocketServer,
	WorkerAgentId,
} from '@sofie-package-manager/api'
import { ExpectationManagerServerOptions } from '../../expectationManager'
import { WorkerAgentAPI } from '../../workerAgentApi'

import { InternalManager } from '../internalManager'

/**  */
export class ExpectationManagerServer {
	public websocketServer?: WebsocketServer

	/** The URL on which the expectationManager can be reached on */
	private _serverAccessUrl = ''

	private logger: LoggerInstance
	constructor(
		logger: LoggerInstance,
		private manager: InternalManager,
		private serverOptions: ExpectationManagerServerOptions,
		private serverAccessBaseUrl: string | undefined,
		private workForceConnectionOptions: ClientConnectionOptions
	) {
		this.logger = logger.category('ExpectationManagerServer')

		if (this.serverOptions.type === 'websocket') {
			this.websocketServer = new WebsocketServer(
				this.serverOptions.port,
				this.logger,
				(client: ClientConnection) => {
					// A new client has connected

					this.logger.info(`New ${client.clientType} connected, id "${client.clientId}"`)

					switch (client.clientType) {
						case 'workerAgent': {
							const clientId = client.clientId as WorkerAgentId
							const expectationManagerMethods = this.manager.getWorkerAgentAPI(clientId)

							const api = new WorkerAgentAPI(this.manager.managerId, expectationManagerMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							this.manager.workerAgents.upsert(clientId, { api, connected: true })
							client.once('close', () => {
								this.logger.warn(`Connection to Worker "${clientId}" closed`)

								const workerAgent = this.manager.workerAgents.get(clientId)
								if (workerAgent) {
									workerAgent.connected = false
									this.manager.workerAgents.remove(clientId)
								}
							})
							this.logger.info(`Connection to Worker "${clientId}" established`)
							this.manager.tracker.triggerEvaluationNow()
							break
						}
						case 'N/A':
						case 'expectationManager':
						case 'appContainer':
							throw new Error(`Unsupported clientType "${client.clientType}"`)
						default: {
							assertNever(client.clientType)
							throw new Error(`Unknown clientType "${client.clientType}"`)
						}
					}
				}
			)

			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`WebsocketServer closed`)
				this.manager.statuses.update('expectationManager.server', {
					statusCode: StatusCode.FATAL,
					message: 'ExpectationManager server closed (Restart Package Manager)',
				})
			})
			this.logger.info(`Expectation Manager running on port ${this.websocketServer.port}`)
		} else {
			// todo: handle direct connections
		}
	}
	public async init(): Promise<void> {
		this._serverAccessUrl = ''
		if (this.workForceConnectionOptions.type === 'internal') {
			this._serverAccessUrl = '__internal'
		} else {
			this._serverAccessUrl = this.serverAccessBaseUrl || 'ws://127.0.0.1'
			if (this.serverOptions.type === 'websocket' && this.serverOptions.port === 0) {
				// When the configured port i 0, the next free port is picked
				this._serverAccessUrl += `:${this.manager.expectationManagerServer.websocketServer?.port}`
			}
		}
		if (!this._serverAccessUrl) throw new Error(`ExpectationManager.serverAccessUrl not set!`)
	}
	terminate(): void {
		if (this.websocketServer) {
			this.websocketServer.terminate()
		}
	}
	public get serverAccessUrl(): string {
		return this._serverAccessUrl
	}
}
