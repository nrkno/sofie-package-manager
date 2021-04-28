import {
	ExpectationManagerWorkerAgent,
	AdapterServer,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeRemoveExpectation,
	AdapterServerOptions,
	PackageContainerExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeRunPackageContainerCronJob,
	ReturnTypeSetupPackageContainerMonitors,
	ReturnTypeDisposePackageContainerMonitors,
} from '@shared/api'

/** Handles communications between a Worker and a Workforce */
export class WorkerAgentAPI
	extends AdapterServer<ExpectationManagerWorkerAgent.ExpectationManager, ExpectationManagerWorkerAgent.WorkerAgent>
	implements ExpectationManagerWorkerAgent.WorkerAgent {
	constructor(
		methods: ExpectationManagerWorkerAgent.ExpectationManager,
		options: AdapterServerOptions<ExpectationManagerWorkerAgent.WorkerAgent>
	) {
		super(methods, options)
	}

	async doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return await this._sendMessage('doYouSupportExpectation', exp)
	}
	async getCostForExpectation(exp: Expectation.Any): Promise<ExpectationManagerWorkerAgent.ExpectationCost> {
		return await this._sendMessage('getCostForExpectation', exp)
	}
	async isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		return await this._sendMessage('isExpectationReadyToStartWorkingOn', exp)
	}
	async isExpectationFullfilled(
		exp: Expectation.Any,
		wasFullfilled: boolean
	): Promise<ReturnTypeIsExpectationFullfilled> {
		return await this._sendMessage('isExpectationFullfilled', exp, wasFullfilled)
	}
	async workOnExpectation(
		exp: Expectation.Any,
		cost: ExpectationManagerWorkerAgent.ExpectationCost
	): Promise<ExpectationManagerWorkerAgent.WorkInProgressInfo> {
		return await this._sendMessage('workOnExpectation', exp, cost)
	}
	async removeExpectation(exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> {
		return await this._sendMessage('removeExpectation', exp)
	}

	async cancelWorkInProgress(wipId: number): Promise<void> {
		return await this._sendMessage('cancelWorkInProgress', wipId)
	}

	// PackageContainer-related methods: ----------------------------------------------------------------------------------------
	async doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportPackageContainer> {
		return await this._sendMessage('doYouSupportPackageContainer', packageContainer)
	}
	async runPackageContainerCronJob(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeRunPackageContainerCronJob> {
		return await this._sendMessage('runPackageContainerCronJob', packageContainer)
	}
	async setupPackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeSetupPackageContainerMonitors> {
		return await this._sendMessage('setupPackageContainerMonitors', packageContainer)
	}
	async disposePackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDisposePackageContainerMonitors> {
		return await this._sendMessage('disposePackageContainerMonitors', packageContainer)
	}
}
