import {
	AdapterClient,
	ExpectationManagerId,
	LoggerInstance,
	WorkForceWorkerAgent,
	WorkerAgentId,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the WorkerAgent
 * Note: The WorkerAgent connects to the Workforce, therefore the WorkerAgent is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/workerAgentApi.ts
 */
export class WorkforceAPI
	extends AdapterClient<WorkForceWorkerAgent.WorkerAgent, WorkForceWorkerAgent.WorkForce>
	implements WorkForceWorkerAgent.WorkForce
{
	constructor(public id: WorkerAgentId, logger: LoggerInstance) {
		super(logger.category('WorkforceAPI'), id, 'workerAgent')
	}
	async getExpectationManagerList(): Promise<{ id: ExpectationManagerId; url: string }[]> {
		return this._sendMessage('getExpectationManagerList', undefined)
	}
}
