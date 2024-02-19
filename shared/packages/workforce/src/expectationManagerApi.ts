import {
	WorkForceExpectationManager,
	AdapterServer,
	AdapterServerOptions,
	LogLevel,
	Statuses,
	WorkforceId,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a ExpectationManager, to be called from the Workforce
 * Note: The ExpectationManager connects to the Workforce, therefore the Workforce is the AdapterServer here.
 * The corresponding other side is implemented at shared/packages/expectationManager/src/workforceApi.ts
 */
export class ExpectationManagerAPI
	extends AdapterServer<WorkForceExpectationManager.WorkForce, WorkForceExpectationManager.ExpectationManager>
	implements WorkForceExpectationManager.ExpectationManager
{
	constructor(
		public id: WorkforceId,
		methods: WorkForceExpectationManager.WorkForce,
		options: AdapterServerOptions<WorkForceExpectationManager.ExpectationManager>
	) {
		super(methods, options)
	}

	async setLogLevel(logLevel: LogLevel): Promise<void> {
		return this._sendMessage('setLogLevel', logLevel)
	}
	async _debugKill(): Promise<void> {
		return this._sendMessage('_debugKill')
	}
	async _debugSendKillConnections(): Promise<void> {
		return this._sendMessage('_debugSendKillConnections')
	}
	async onWorkForceStatus(statuses: Statuses): Promise<void> {
		return this._sendMessage('onWorkForceStatus', statuses)
	}
}
