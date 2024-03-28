import {
	AppContainerWorkerAgent,
	AdapterServerOptions,
	LogLevel,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	PackageContainerExpectation,
	AppContainerId,
} from '@sofie-package-manager/api'

export class WorkerAgentAPI implements AppContainerWorkerAgent.WorkerAgent {
	constructor(
		public id: AppContainerId,
		methods: AppContainerWorkerAgent.AppContainer,
		_options: AdapterServerOptions<AppContainerWorkerAgent.WorkerAgent>
	) {
		WorkerAgentAPI.mockAppContainer = methods
	}

	static mockAppContainer: AppContainerWorkerAgent.AppContainer | null = null

	type = ''

	async setLogLevel(_logLevel: LogLevel): Promise<void> {
		return
	}
	async _debugKill(): Promise<void> {
		return
	}
	async doYouSupportExpectation(_exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return {
			support: true,
		}
	}
	async doYouSupportPackageContainer(
		_packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportExpectation> {
		return {
			support: true,
		}
	}
	async setSpinDownTime(_spinDownTime: number): Promise<void> {
		return
	}
}
