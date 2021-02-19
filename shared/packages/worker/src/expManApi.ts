import { ExpectationManagerWorkerAgent, AdapterClient } from '@shared/api'

/** Handles communications between a WorkerAgent and the ExpectationManager */
export class ExpectationManagerAPI
	extends AdapterClient<ExpectationManagerWorkerAgent.WorkerAgent, ExpectationManagerWorkerAgent.ExpectationManager>
	implements ExpectationManagerWorkerAgent.ExpectationManager {
	constructor() {
		super('workerAgent')
	}
	async messageFromWorker(message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload): Promise<any> {
		return await this._sendMessage('messageFromWorker', message)
	}
	async wipEventProgress(wipId: number, actualVersionHash: string | null, progress: number): Promise<void> {
		return await this._sendMessage('wipEventProgress', wipId, actualVersionHash, progress)
	}
	async wipEventDone(wipId: number, actualVersionHash: string, reason: string, result: unknown): Promise<void> {
		return await this._sendMessage('wipEventDone', wipId, actualVersionHash, reason, result)
	}
	async wipEventError(wipId: number, error: string): Promise<void> {
		return await this._sendMessage('wipEventError', wipId, error)
	}
}
