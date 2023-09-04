import {
	AdapterClient,
	AppContainerId,
	AppType,
	LoggerInstance,
	WorkForceAppContainer,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the AppContainer
 * Note: The AppContainer connects to the Workforce, therefore the AppContainer is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/appContainerApi.ts
 */
export class WorkforceAPI
	extends AdapterClient<WorkForceAppContainer.AppContainer, WorkForceAppContainer.WorkForce>
	implements WorkForceAppContainer.WorkForce
{
	constructor(public id: AppContainerId, logger: LoggerInstance) {
		super(logger.category('WorkforceAPI'), id, 'appContainer')
	}
	async registerAvailableApps(availableApps: { appType: AppType }[]): Promise<void> {
		return this._sendMessage('registerAvailableApps', availableApps)
	}
}
