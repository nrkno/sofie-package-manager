import { AdapterClient, LoggerInstance, WorkForceExpectationManager, WorkforceStatus } from '@shared/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the ExpectationManager
 * Note: The ExpectationManager connects to the Workforce, therefore the ExpectationManager is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/expectationManagerApi.ts
 */
export class WorkforceAPI
	extends AdapterClient<WorkForceExpectationManager.ExpectationManager, WorkForceExpectationManager.WorkForce>
	implements WorkForceExpectationManager.WorkForce {
	constructor(logger: LoggerInstance) {
		super(logger, 'expectationManager')
	}
	async registerExpectationManager(managerId: string, url: string): Promise<void> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('registerExpectationManager', managerId, url)
	}
	async getStatus(): Promise<WorkforceStatus> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('getStatus')
	}
	async _debugKillApp(appId: string): Promise<void> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('_debugKillApp', appId)
	}
}
