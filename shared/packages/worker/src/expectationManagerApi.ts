import {
	PackageContainerId,
	MonitorId,
	WorkerAgentId,
	WorkInProgressLocalId,
	StatusCode,
	ExpectationManagerWorkerAgent,
	AdapterClient,
	LoggerInstance,
	Reason,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a ExpectationManager, to be called from the WorkerAgent
 * Note: The WorkerAgent connects to the ExpectationManager, so the WorkerAgent is the AdapterClient.
 * The corresponding other side is implemented at shared/packages/expectationManager/src/workerAgentApi.ts
 */
export class ExpectationManagerAPI
	extends AdapterClient<ExpectationManagerWorkerAgent.WorkerAgent, ExpectationManagerWorkerAgent.ExpectationManager>
	implements ExpectationManagerWorkerAgent.ExpectationManager
{
	constructor(public id: WorkerAgentId, logger: LoggerInstance) {
		super(logger.category('ExpectationManagerAPI'), id, 'workerAgent')
	}

	async messageFromWorker(message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any): Promise<any> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('messageFromWorker', message)
	}
	async wipEventProgress(
		wipId: WorkInProgressLocalId,
		actualVersionHash: string | null,
		progress: number
	): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('wipEventProgress', wipId, actualVersionHash, progress)
	}
	async wipEventDone(
		wipId: WorkInProgressLocalId,
		actualVersionHash: string,
		reason: Reason,
		result: unknown
	): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('wipEventDone', wipId, actualVersionHash, reason, result)
	}
	async wipEventError(wipId: WorkInProgressLocalId, reason: Reason): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('wipEventError', wipId, reason)
	}
	async monitorStatus(
		packageContainerId: PackageContainerId,
		monitorId: MonitorId,
		status: StatusCode,
		reason: Reason
	): Promise<void> {
		// This call is ultimately received at shared/packages/expectationManager/src/workerAgentApi.ts
		return this._sendMessage('monitorStatus', packageContainerId, monitorId, status, reason)
	}
}
