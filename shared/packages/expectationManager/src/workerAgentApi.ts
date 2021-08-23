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

/**
 * Exposes the API-methods of a WorkerAgent, to be called from the ExpectationManager
 * Note: The WorkerAgent connects to the ExpectationManager, therefore the ExpectationManager is the AdapterServer here.
 * The corresponding other side is implemented at shared/packages/worker/src/expectationManagerApi.ts
 */
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
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('doYouSupportExpectation', exp)
	}
	async getCostForExpectation(exp: Expectation.Any): Promise<ExpectationManagerWorkerAgent.ExpectationCost> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('getCostForExpectation', exp)
	}
	async isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('isExpectationReadyToStartWorkingOn', exp)
	}
	async isExpectationFullfilled(
		exp: Expectation.Any,
		wasFullfilled: boolean
	): Promise<ReturnTypeIsExpectationFullfilled> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('isExpectationFullfilled', exp, wasFullfilled)
	}
	async workOnExpectation(
		exp: Expectation.Any,
		cost: ExpectationManagerWorkerAgent.ExpectationCost
	): Promise<ExpectationManagerWorkerAgent.WorkInProgressInfo> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('workOnExpectation', exp, cost)
	}
	async removeExpectation(exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('removeExpectation', exp)
	}

	async cancelWorkInProgress(wipId: number): Promise<void> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('cancelWorkInProgress', wipId)
	}

	// PackageContainer-related methods: ----------------------------------------------------------------------------------------
	async doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportPackageContainer> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('doYouSupportPackageContainer', packageContainer)
	}
	async runPackageContainerCronJob(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeRunPackageContainerCronJob> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('runPackageContainerCronJob', packageContainer)
	}
	async setupPackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeSetupPackageContainerMonitors> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('setupPackageContainerMonitors', packageContainer)
	}
	async disposePackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDisposePackageContainerMonitors> {
		// Note: This call is ultimately received in shared/packages/worker/src/workerAgent.ts
		return this._sendMessage('disposePackageContainerMonitors', packageContainer)
	}
}
