import { AdapterClient, WorkForceWorkerAgent } from '@shared/api'

/** Handles communications between a Worker and a Workforce */
export class WorkforceAPI
	extends AdapterClient<WorkForceWorkerAgent.WorkerAgent, WorkForceWorkerAgent.WorkForce>
	implements WorkForceWorkerAgent.WorkForce {
	constructor() {
		super('workerAgent')
	}
	async getExpectationManagerList(): Promise<{ id: string; url: string }[]> {
		return await this._sendMessage('getExpectationManagerList', undefined)
	}
}
