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
	async ping(): Promise<void> {
		return this._sendMessage('ping')
	}
	async requestSpinDown(): Promise<void> {
		return this._sendMessage('requestSpinDown')
	}
}
