import { WorkForceAppContainer, AdapterServer, AdapterServerOptions, LogLevel, Expectation } from '@shared/api'

/**
 * Exposes the API-methods of a AppContainer, to be called from the Workforce
 * Note: The AppContainer connects to the Workforce, therefore the Workforce is the AdapterServer here.
 * The corresponding other side is implemented at shared/packages/worker/src/workforceApi.ts
 */
export class AppContainerAPI
	extends AdapterServer<WorkForceAppContainer.WorkForce, WorkForceAppContainer.AppContainer>
	implements WorkForceAppContainer.AppContainer {
	constructor(
		methods: WorkForceAppContainer.WorkForce,
		options: AdapterServerOptions<WorkForceAppContainer.AppContainer>
	) {
		super(methods, options)
	}

	async setLogLevel(logLevel: LogLevel): Promise<void> {
		return this._sendMessage('setLogLevel', logLevel)
	}
	async _debugKill(): Promise<void> {
		return this._sendMessage('_debugKill')
	}

	async requestAppTypeForExpectation(exp: Expectation.Any): Promise<{ appType: string; cost: number } | null> {
		return this._sendMessage('requestAppTypeForExpectation', exp)
	}
	async spinUp(appType: string): Promise<string> {
		return this._sendMessage('spinUp', appType)
	}
	async spinDown(appId: string): Promise<void> {
		return this._sendMessage('spinDown', appId)
	}
	async getRunningApps(): Promise<{ appId: string; appType: string }[]> {
		return this._sendMessage('getRunningApps')
	}
}
