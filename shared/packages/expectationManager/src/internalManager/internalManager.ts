import {
	StatusCode,
	ClientConnectionOptions,
	ExpectationManagerWorkerAgent,
	Hook,
	LoggerInstance,
	Reason,
} from '@sofie-package-manager/api'

import { WorkerAgentAPI } from '../workerAgentApi'
import { getDefaultConstants } from '../lib/constants'
import { ExpectationTracker } from '../expectationTracker/expectationTracker'
import { TrackedWorkerAgents } from './lib/trackedWorkerAgents'
import { ManagerStatusMonitor } from './lib/managerStatusMonitor'
import {
	ExpectationManagerCallbacks,
	ExpectationManagerOptions,
	ExpectationManagerServerOptions,
} from '../expectationManager'
import { ManagerStatusReporter } from './lib/managerStatusReporter'
import { WorkforceConnection } from './lib/workforceConnection'
import { ExpectationManagerServer } from './lib/expectationManagerServer'
import { StatusReportCache } from './lib/statusReportCache'

/**
 * ExpectationManagerInternal contains methods that are used internally in this library.
 * It is used by ExpectationManager.
 *
 */
export class InternalManager {
	public workforceConnection: WorkforceConnection
	public expectationManagerServer: ExpectationManagerServer

	public tracker: ExpectationTracker
	public workerAgents: TrackedWorkerAgents
	public statuses: ManagerStatusReporter

	private enableChaosMonkey = false
	private managerMonitor: ManagerStatusMonitor

	public statusReport: StatusReportCache

	private logger: LoggerInstance

	constructor(
		logger: LoggerInstance,
		public readonly managerId: string,
		serverOptions: ExpectationManagerServerOptions,
		/** At what url the ExpectationManager can be reached on */
		serverAccessBaseUrl: string | undefined,
		workForceConnectionOptions: ClientConnectionOptions,
		public callbacks: ExpectationManagerCallbacks,
		options?: ExpectationManagerOptions
	) {
		this.logger = logger.category('ExpectationManager')

		const constants = {
			...getDefaultConstants(),
			...options?.constants,
		}

		this.workforceConnection = new WorkforceConnection(this.logger, this, workForceConnectionOptions)
		this.expectationManagerServer = new ExpectationManagerServer(
			this.logger,
			this,
			serverOptions,
			serverAccessBaseUrl,
			workForceConnectionOptions
		)
		this.tracker = new ExpectationTracker(this, this.logger, constants, callbacks)
		this.workerAgents = new TrackedWorkerAgents(this.logger, this.tracker)
		this.statuses = new ManagerStatusReporter(this.callbacks)
		this.managerMonitor = new ManagerStatusMonitor(this.logger, this.tracker, this.statuses)
		this.statusReport = new StatusReportCache(this)

		this.enableChaosMonkey = options?.chaosMonkey ?? false
	}

	/** Initialize the ExpectationManager. This method is should be called shortly after the class has been instantiated. */
	async init(): Promise<void> {
		await this.expectationManagerServer.init()
		await this.workforceConnection.init()

		if (this.enableChaosMonkey) {
			// Chaos-monkey, make the various processes cut their connections, to ensure that the reconnection works:
			setInterval(() => {
				this.logger.info('Chaos Monkey says: "KILLING CONNNECTIONS" ==========')
				this.sendDebugKillConnections().catch(this.logger.error)
			}, 30 * 1000)
		}

		this.tracker.triggerEvaluationNow()

		this.logger.info(`Initialized"`)
	}

	terminate(): void {
		this.tracker.terminate()
		this.expectationManagerServer.terminate()
		this.workforceConnection.terminate()
		this.managerMonitor.terminate()
	}
	/** USED IN TESTS ONLY. Quickly reset the tracked work of the expectationManager. */
	resetWork(): void {
		this.tracker.resetWork()
	}
	/** USED IN TESTS ONLY. Send out a message to all connected processes that they are to cut their connections. This is to test resilience. */
	async sendDebugKillConnections(): Promise<void> {
		await this.workforceConnection.sendDebugKillConnections()
	}
	/** Returns a Hook used to hook up a WorkerAgent to our API-methods. */
	getWorkerAgentHook(): Hook<
		ExpectationManagerWorkerAgent.ExpectationManager,
		ExpectationManagerWorkerAgent.WorkerAgent
	> {
		return (clientId: string, clientMethods: ExpectationManagerWorkerAgent.WorkerAgent) => {
			// On connection from a workerAgent

			const workerAgentMethods = this.getWorkerAgentAPI(clientId)
			const api = new WorkerAgentAPI(workerAgentMethods, {
				type: 'internal',
				hookMethods: clientMethods,
			})
			this.workerAgents.upsert(clientId, { api, connected: true })

			return workerAgentMethods
		}
	}
	removeWorkerAgentHook(clientId: string): void {
		const workerAgent = this.workerAgents.get(clientId)
		if (!workerAgent) throw new Error(`WorkerAgent "${clientId}" not found!`)

		if (workerAgent.api.type !== 'internal')
			throw new Error(`Cannot remove WorkerAgent "${clientId}", due to the type being "${workerAgent.api.type}"`)

		workerAgent.connected = false
		this.workerAgents.remove(clientId)
	}

	/** Return the API-methods that the ExpectationManager exposes to the WorkerAgent */
	public getWorkerAgentAPI(clientId: string): ExpectationManagerWorkerAgent.ExpectationManager {
		return {
			messageFromWorker: async (
				message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any
			): Promise<any> => {
				return this.callbacks.messageFromWorker(message)
			},

			wipEventProgress: async (
				wipId: number,
				actualVersionHash: string | null,
				progress: number
			): Promise<void> => {
				await this.tracker.worksInProgress.onWipEventProgress(clientId, wipId, actualVersionHash, progress)
			},
			wipEventDone: async (
				wipId: number,
				actualVersionHash: string,
				reason: Reason,
				result: any
			): Promise<void> => {
				await this.tracker.worksInProgress.onWipEventDone(clientId, wipId, actualVersionHash, reason, result)
			},
			wipEventError: async (wipId: number, reason: Reason): Promise<void> => {
				await this.tracker.worksInProgress.onWipEventError(clientId, wipId, reason)
			},
			monitorStatus: async (
				packageContainerId: string,
				monitorId: string,
				status: StatusCode,
				reason: Reason
			) => {
				await this.tracker.onMonitorStatus(packageContainerId, monitorId, status, reason)
			},
		}
	}
}
