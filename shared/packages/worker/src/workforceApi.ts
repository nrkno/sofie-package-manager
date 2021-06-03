import { AdapterClient, LoggerInstance, WorkForceWorkerAgent } from '@shared/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the WorkerAgent
 * Note: The WorkerAgent connects to the Workforce, therefore the WorkerAgent is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/workerAgentApi.ts
 */
export class WorkforceAPI
	extends AdapterClient<WorkForceWorkerAgent.WorkerAgent, WorkForceWorkerAgent.WorkForce>
	implements WorkForceWorkerAgent.WorkForce {
	constructor(logger: LoggerInstance) {
		super(logger, 'workerAgent')
	}
	async getExpectationManagerList(): Promise<{ id: string; url: string }[]> {
		return await this._sendMessage('getExpectationManagerList', undefined)
	}
}
