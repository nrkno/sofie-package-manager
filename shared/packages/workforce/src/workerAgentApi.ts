import {
	WorkForceWorkerAgent,
	AdapterServer,
	AdapterServerOptions,
	LogLevel,
	WorkerStatusReport,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a WorkerAgent, to be called from the Workforce
 * Note: The WorkerAgent connects to the Workforce, therefore the Workforce is the AdapterServer here.
 * The corresponding other side is implemented at shared/packages/worker/src/workforceApi.ts
 */
export class WorkerAgentAPI
	extends AdapterServer<WorkForceWorkerAgent.WorkForce, WorkForceWorkerAgent.WorkerAgent>
	implements WorkForceWorkerAgent.WorkerAgent
{
	constructor(
		methods: WorkForceWorkerAgent.WorkForce,
		options: AdapterServerOptions<WorkForceWorkerAgent.WorkerAgent>
	) {
		super(methods, options)
	}

	async setLogLevel(logLevel: LogLevel): Promise<void> {
		return this._sendMessage('setLogLevel', logLevel)
	}
	async _debugKill(): Promise<void> {
		return this._sendMessage('_debugKill')
	}
	async _debugSendKillConnections(): Promise<void> {
		return this._sendMessage('_debugSendKillConnections')
	}
	async getStatusReport(): Promise<WorkerStatusReport> {
		return this._sendMessage('getStatusReport')
	}

	async expectationManagerAvailable(id: string, url: string): Promise<void> {
		return this._sendMessage('expectationManagerAvailable', id, url)
	}
	async expectationManagerGone(id: string): Promise<void> {
		return this._sendMessage('expectationManagerGone', id)
	}
}
