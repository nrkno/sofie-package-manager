import { ExpectationManagerWorkerAgent, AdapterClient, LoggerInstance, Reason } from '@shared/api'
import { StatusCode } from '@sofie-automation/blueprints-integration'

/**
 * Exposes the API-methods of a ExpectationManager, to be called from the WorkerAgent
 * Note: The WorkerAgent connects to the ExpectationManager, so the WorkerAgent is the AdapterClient.
 * The corresponding other side is implemented at shared/packages/expectationManager/src/workerAgentApi.ts
 */
export class ExpectationManagerAPI
	extends AdapterClient<ExpectationManagerWorkerAgent.WorkerAgent, ExpectationManagerWorkerAgent.ExpectationManager>
	implements ExpectationManagerWorkerAgent.ExpectationManager {
	constructor(logger: LoggerInstance) {
		super(logger, 'workerAgent')
	}

	async messageFromWorker(message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any): Promise<any> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('messageFromWorker', message)
	}
	async wipEventProgress(wipId: number, actualVersionHash: string | null, progress: number): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('wipEventProgress', wipId, actualVersionHash, progress)
	}
	async wipEventDone(wipId: number, actualVersionHash: string, reason: Reason, result: unknown): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('wipEventDone', wipId, actualVersionHash, reason, result)
	}
	async wipEventError(wipId: number, reason: Reason): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('wipEventError', wipId, reason)
	}
	async monitorStatus(
		packageContainerId: string,
		monitorId: string,
		status: StatusCode,
		reason: Reason
	): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('monitorStatus', packageContainerId, monitorId, status, reason)
	}
}
