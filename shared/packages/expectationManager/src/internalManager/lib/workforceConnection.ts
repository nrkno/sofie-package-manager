import {
	AppId,
	ClientConnectionOptions,
	LoggerInstance,
	LogLevel,
	setLogLevel,
	Status,
	StatusCode,
	Statuses,
	stringifyError,
	unprotectString,
	WORKFORCE_ID,
} from '@sofie-package-manager/api'
import { WorkforceAPI } from '../../workforceApi'
import { InternalManager } from '../internalManager'

/**  */
export class WorkforceConnection {
	/** API to the Workforce */
	public workforceAPI: WorkforceAPI

	private initWorkForceAPIPromise?: { resolve: () => void; reject: (reason?: any) => void }

	private logger: LoggerInstance
	constructor(
		logger: LoggerInstance,
		private manager: InternalManager,
		private workForceConnectionOptions: ClientConnectionOptions
	) {
		this.logger = logger.category('WorkforceConnection')

		this.workforceAPI = new WorkforceAPI(this.manager.managerId, this.logger)
		this.workforceAPI.on('disconnected', () => {
			this.logger.warn('Workforce disconnected')
			this.manager.statuses.update(unprotectString(WORKFORCE_ID), {
				statusCode: StatusCode.BAD,
				message: 'Workforce disconnected (Restart Package Manager if this persists)',
			})
		})
		this.workforceAPI.on('connected', () => {
			this.logger.info('Workforce connected')
			this.manager.statuses.update(unprotectString(WORKFORCE_ID), { statusCode: StatusCode.GOOD, message: '' })

			this.workforceAPI
				.registerExpectationManager(
					this.manager.managerId,
					this.manager.expectationManagerServer.serverAccessUrl
				)
				.then(() => {
					this.initWorkForceAPIPromise?.resolve() // To finish the init() function
				})
				.catch((err) => {
					this.logger.error(`Error in registerExpectationManager: ${stringifyError(err)}`)
					this.initWorkForceAPIPromise?.reject(err)
				})
		})
		this.workforceAPI.on('error', (err) => {
			this.logger.error(`Workforce error event: ${stringifyError(err)}`)
		})
	}
	public async init(): Promise<void> {
		await this.workforceAPI.init(this.workForceConnectionOptions, {
			setLogLevel: async (logLevel: LogLevel): Promise<void> => {
				setLogLevel(logLevel)
			},
			_debugKill: async (): Promise<void> => {
				// This is for testing purposes only
				setTimeout(() => {
					// eslint-disable-next-line no-process-exit
					process.exit(42)
				}, 1)
			},
			_debugSendKillConnections: async (): Promise<void> => {
				await this._debugSendKillConnections()
			},
			onWorkForceStatus: async (statuses: Statuses): Promise<void> => {
				for (const [id, status] of Object.entries<Status | null>(statuses)) {
					this.manager.statuses.update(`workforce-${id}`, status)
				}
			},
		})

		// Wait for the this.workforceAPI to be ready before continuing:
		await new Promise<void>((resolve, reject) => {
			this.initWorkForceAPIPromise = { resolve, reject }
		})
	}
	public terminate(): void {
		this.workforceAPI.terminate()
	}

	async setLogLevelOfApp(appId: AppId, logLevel: LogLevel): Promise<void> {
		return this.workforceAPI.setLogLevelOfApp(appId, logLevel)
	}

	/** USED IN TESTS ONLY. Send out a message to all connected processes that they are to cut their connections. This is to test resilience. */
	async sendDebugKillConnections(): Promise<void> {
		await this.workforceAPI._debugSendKillConnections()
	}
	/** FOR DEBUGGING ONLY. Cut websocket connections, in order to ensure that they are restarted */
	async _debugSendKillConnections(): Promise<void> {
		this.workforceAPI.debugCutConnection()
		// note: workers cut their own connections
	}
}
