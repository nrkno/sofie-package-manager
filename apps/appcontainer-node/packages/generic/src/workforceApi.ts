import { AdapterClient, LoggerInstance, WorkForceAppContainer } from '@shared/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the AppContainer
 * Note: The AppContainer connects to the Workforce, therefore the AppContainer is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/appContainerApi.ts
 */
export class WorkforceAPI
	extends AdapterClient<WorkForceAppContainer.AppContainer, WorkForceAppContainer.WorkForce>
	implements WorkForceAppContainer.WorkForce {
	constructor(logger: LoggerInstance) {
		super(logger, 'appContainer')
	}
	async registerAvailableApps(availableApps: { appType: string }[]): Promise<void> {
		return this._sendMessage('registerAvailableApps', availableApps)
	}
}
