import { AdapterClient, WorkForceExpectationManager } from '@shared/api'

/** Handles communications between a ExpectationManager and the Workforce */
export class WorkforceAPI
	extends AdapterClient<WorkForceExpectationManager.ExpectationManager, WorkForceExpectationManager.WorkForce>
	implements WorkForceExpectationManager.WorkForce {
	constructor() {
		super('expectationManager')
	}
	async registerExpectationManager(managerId: string, url: string): Promise<void> {
		return await this._sendMessage('registerExpectationManager', managerId, url)
	}
}
