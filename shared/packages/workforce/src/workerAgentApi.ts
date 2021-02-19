import { WorkForceWorkerAgent, AdapterServer, AdapterServerOptions } from '@shared/api'

/** Handles communications between a Worker and a Workforce */
export class WorkerAgentAPI
	extends AdapterServer<WorkForceWorkerAgent.WorkForce, WorkForceWorkerAgent.WorkerAgent>
	implements WorkForceWorkerAgent.WorkerAgent {
	constructor(
		methods: WorkForceWorkerAgent.WorkForce,
		options: AdapterServerOptions<WorkForceWorkerAgent.WorkerAgent>
	) {
		super(methods, options)
	}

	async expectationManagerAvailable(id: string, url: string): Promise<void> {
		return await this._sendMessage('expectationManagerAvailable', id, url)
	}
	async expectationManagerGone(id: string): Promise<void> {
		return await this._sendMessage('expectationManagerGone', id)
	}
}
