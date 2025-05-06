import {
	AdapterClient,
	LoggerInstance,
	AppContainerWorkerAgent,
	WorkerAgentId,
	DataId,
	LockId,
	protectString,
	ClientConnectionOptions,
	Hook,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the WorkerAgent
 * Note: The WorkerAgent connects to the Workforce, therefore the WorkerAgent is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/workerAgentApi.ts
 */
export class DummyAppContainerAPI
	extends AdapterClient<AppContainerWorkerAgent.WorkerAgent, AppContainerWorkerAgent.AppContainer>
	implements AppContainerWorkerAgent.AppContainer
{
	private workerStorage: Map<DataId, any> = new Map()

	constructor(public id: WorkerAgentId, logger: LoggerInstance) {
		super(logger, id, 'N/A')
		this.on('error', () => {
			// an empty error handler to avoid HelpfulEventEmitter complaining
			return
		})
	}
	protected _sendMessage = async (
		_type: keyof AppContainerWorkerAgent.AppContainer,
		..._args: any[]
	): Promise<any> => {
		return
	}
	async init(
		connectionOptions: ClientConnectionOptions | NoClientConnectionOptions,
		_clientMethods: Omit<AppContainerWorkerAgent.WorkerAgent, 'id'>
	): Promise<void> {
		if (connectionOptions.type !== 'none') throw new Error('Invalid connection type for DummyAppContainerAPI')
	}
	hook(_serverHook: Hook<AppContainerWorkerAgent.AppContainer, AppContainerWorkerAgent.WorkerAgent>): void {
		return
	}
	terminate(): void {
		return
	}
	debugCutConnection(): void {
		return
	}
	get connected(): boolean {
		return true
	}
	protected addHelpfulEventCheck(_event: string): void {
		return
	}
	async ping(): Promise<void> {
		return
	}
	async requestSpinDown(): Promise<void> {
		return
	}
	async workerStorageWriteLock(dataId: DataId): Promise<{ lockId: LockId; current: any }> {
		return { lockId: protectString('dummy'), current: this.workerStorage.get(dataId) }
	}
	async workerStorageReleaseLock(): Promise<void> {
		return
	}
	async workerStorageWrite(dataId: DataId, _lockId: LockId, data: string): Promise<void> {
		this.workerStorage.set(dataId, data)
		return
	}
	async workerStorageRead(dataId: DataId): Promise<any> {
		return this.workerStorage.get(dataId)
	}
}

export type NoClientConnectionOptions = {
	type: 'none'
}
