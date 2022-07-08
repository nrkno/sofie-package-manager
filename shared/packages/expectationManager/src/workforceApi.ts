import {
	WorkForceExpectationManager,
	AdapterClient,
	LoggerInstance,
	LogLevel,
	WorkforceStatusReport,
	Expectation,
	PackageContainerExpectation,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a Workforce, to be called from the ExpectationManager
 * Note: The ExpectationManager connects to the Workforce, therefore the ExpectationManager is the AdapterClient here.
 * The corresponding other side is implemented at shared/packages/workforce/src/expectationManagerApi.ts
 */
export class WorkforceAPI
	extends AdapterClient<WorkForceExpectationManager.ExpectationManager, WorkForceExpectationManager.WorkForce>
	implements WorkForceExpectationManager.WorkForce
{
	constructor(logger: LoggerInstance) {
		super(logger.category('WorkforceAPI'), 'expectationManager')
	}

	async registerExpectationManager(managerId: string, url: string): Promise<void> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('registerExpectationManager', managerId, url)
	}
	async getStatusReport(): Promise<WorkforceStatusReport> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('getStatusReport')
	}
	async setLogLevel(logLevel: LogLevel): Promise<void> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('setLogLevel', logLevel)
	}
	async setLogLevelOfApp(appId: string, logLevel: LogLevel): Promise<void> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('setLogLevelOfApp', appId, logLevel)
	}
	async _debugKillApp(appId: string): Promise<void> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('_debugKillApp', appId)
	}
	async _debugSendKillConnections(): Promise<void> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('_debugSendKillConnections')
	}
	async requestResourcesForExpectation(exp: Expectation.Any): Promise<boolean> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('requestResourcesForExpectation', exp)
	}
	async requestResourcesForPackageContainer(packageContainer: PackageContainerExpectation): Promise<boolean> {
		// Note: This call is ultimately received in shared/packages/workforce/src/workforce.ts
		return this._sendMessage('requestResourcesForPackageContainer', packageContainer)
	}
}
