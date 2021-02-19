import {
	ExpectationManagerWorkerAgent,
	AdapterServer,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeRemoveExpectation,
	AdapterServerOptions,
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
}
