import {
	AppContainerWorkerAgent,
	AdapterServer,
	AdapterServerOptions,
	LogLevel,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	PackageContainerExpectation,
	AppContainerId,
} from '@sofie-package-manager/api'

/**
 * Exposes the API-methods of a WorkerAgent, to be called from the AppContainer
 * Note: The WorkerAgent connects to the AppContainer, therefore the AppContainer is the AdapterServer here.
 * The corresponding other side is implemented at shared/packages/worker/src/appContainerApi.ts
 */
export class WorkerAgentAPI
	extends AdapterServer<AppContainerWorkerAgent.AppContainer, AppContainerWorkerAgent.WorkerAgent>
	implements AppContainerWorkerAgent.WorkerAgent
{
	constructor(
		public id: AppContainerId,
		methods: AppContainerWorkerAgent.AppContainer,
		options: AdapterServerOptions<AppContainerWorkerAgent.WorkerAgent>
	) {
		super(methods, options)
	}

	async setLogLevel(logLevel: LogLevel): Promise<void> {
		return this._sendMessage('setLogLevel', logLevel)
	}
	async _debugKill(): Promise<void> {
		return this._sendMessage('_debugKill')
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return this._sendMessage('doYouSupportExpectation', exp)
	}
	async doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportExpectation> {
		return this._sendMessage('doYouSupportPackageContainer', packageContainer)
	}
	async setSpinDownTime(spinDownTime: number): Promise<void> {
		return this._sendMessage('setSpinDownTime', spinDownTime)
	}
}
