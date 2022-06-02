import { AdapterClient, LoggerInstance, AppContainerWorkerAgent } from '@shared/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the WorkerAgent
 * Note: The WorkerAgent connects to the Workforce, therefore the WorkerAgent is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/workerAgentApi.ts
 */
export class AppContainerAPI
	extends AdapterClient<AppContainerWorkerAgent.WorkerAgent, AppContainerWorkerAgent.AppContainer>
	implements AppContainerWorkerAgent.AppContainer {
	constructor(logger: LoggerInstance) {
		super(logger.category('AppContainerAPI'), 'workerAgent')
	}
	// Note: These calls are ultimately received at apps/appcontainer-node/packages/generic/src/appContainer.ts
	async ping(): Promise<void> {
		return this._sendMessage('ping')
	}
	async requestSpinDown(): Promise<void> {
		return this._sendMessage('requestSpinDown')
	}
	async workerStorageWriteLock(dataId: string): Promise<{ lockId: string; current: any | undefined }> {
		return this._sendMessage('workerStorageWriteLock', dataId)
	}
	async workerStorageReleaseLock(dataId: string, lockId: string): Promise<void> {
		return this._sendMessage('workerStorageReleaseLock', dataId, lockId)
	}
	async workerStorageWrite(dataId: string, lockId: string, data: string): Promise<void> {
		return this._sendMessage('workerStorageWrite', dataId, lockId, data)
	}
	async workerStorageRead(dataId: string): Promise<any> {
		return this._sendMessage('workerStorageRead', dataId)
	}
}
