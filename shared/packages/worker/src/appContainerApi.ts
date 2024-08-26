import {
	AdapterClient,
	LoggerInstance,
	AppContainerWorkerAgent,
	WorkerAgentId,
	DataId,
	LockId,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the WorkerAgent
 * Note: The WorkerAgent connects to the Workforce, therefore the WorkerAgent is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/workerAgentApi.ts
 */
export class AppContainerAPI
	extends AdapterClient<AppContainerWorkerAgent.WorkerAgent, AppContainerWorkerAgent.AppContainer>
	implements AppContainerWorkerAgent.AppContainer
{
	constructor(public id: WorkerAgentId, logger: LoggerInstance) {
		super(logger.category('AppContainerAPI'), id, 'workerAgent')
	}
	// Note: These calls are ultimately received at apps/appcontainer-node/packages/generic/src/appContainer.ts
	async ping(): Promise<void> {
		return this._sendMessage('ping')
	}
	async requestSpinDown(force?: boolean): Promise<void> {
		return this._sendMessage('requestSpinDown', force)
	}
	async workerStorageWriteLock(
		dataId: DataId,
		customTimeout?: number
	): Promise<{ lockId: LockId; current: any | undefined }> {
		return this._sendMessage('workerStorageWriteLock', dataId, customTimeout)
	}
	async workerStorageReleaseLock(dataId: DataId, lockId: LockId): Promise<void> {
		return this._sendMessage('workerStorageReleaseLock', dataId, lockId)
	}
	async workerStorageWrite(dataId: DataId, lockId: LockId, data: string): Promise<void> {
		return this._sendMessage('workerStorageWrite', dataId, lockId, data)
	}
	async workerStorageRead(dataId: DataId): Promise<any> {
		return this._sendMessage('workerStorageRead', dataId)
	}
}
