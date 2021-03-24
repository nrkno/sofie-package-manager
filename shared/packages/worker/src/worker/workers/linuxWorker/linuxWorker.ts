import { IWorkInProgress } from '../../lib/workInProgress'
import {
	Expectation,
	ExpectationManagerWorkerAgent,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	WorkerAgentConfig,
} from '@shared/api'

import { GenericWorker, WorkerLocation } from '../../worker'

/** This is a type of worker that runs on a linux machine */
export class LinuxWorker extends GenericWorker {
	static readonly type = 'linuxWorker'
	constructor(
		public readonly config: WorkerAgentConfig,
		sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker,
		location: WorkerLocation
	) {
		super(config, location, sendMessageToManager, LinuxWorker.type)
	}
	async doYouSupportExpectation(_exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return {
			support: false,
			reason: `Not implemented yet`,
		}
	}
	getCostFortExpectation(_exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation> {
		throw new Error(`Not implemented yet`)
	}
	isExpectationReadyToStartWorkingOn(_exp: Expectation.Any): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		throw new Error(`Not implemented yet`)
	}
	isExpectationFullfilled(
		_exp: Expectation.Any,
		_wasFullfilled: boolean
	): Promise<ReturnTypeIsExpectationFullfilled> {
		throw new Error(`Not implemented yet`)
	}
	workOnExpectation(_exp: Expectation.Any): Promise<IWorkInProgress> {
		throw new Error(`Not implemented yet`)
	}
	removeExpectation(_exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> {
		throw new Error(`Not implemented yet`)
	}
}
