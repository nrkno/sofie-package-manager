import { MessageFromWorker } from '../../../workerAgent'
import { Expectation } from '../../expectationApi'

import { GenericWorker, IWorkInProgress } from '../../worker'

/** This is a type of worker that runs on a linux machine */
export class WindowsWorker extends GenericWorker {
	constructor(
		sendMessageToManager: MessageFromWorker,
		/** The name/identifier of the computer that this runs on */
		private localComputerId?: string,
		/** The names/identifiers of the local network that this has access to */
		private localNetworkIds: string[] = []
	) {
		super(sendMessageToManager)
		console.log(this.localComputerId, this.localNetworkIds) // remove this
	}
	async doYouSupportExpectation(_exp: Expectation.Any): Promise<{ support: boolean; reason: string }> {
		return {
			support: false,
			reason: `Not implemented yet`,
		}
	}
	isExpectationReadyToStartWorkingOn(_exp: Expectation.Any): Promise<{ ready: boolean; reason: string }> {
		throw new Error(`Not implemented yet`)
	}
	isExpectationFullfilled(_exp: Expectation.Any): Promise<{ fulfilled: boolean; reason: string }> {
		throw new Error(`Not implemented yet`)
	}
	workOnExpectation(_exp: Expectation.Any): Promise<IWorkInProgress> {
		throw new Error(`Not implemented yet`)
	}
	removeExpectation(_exp: Expectation.Any): Promise<{ removed: boolean; reason: string }> {
		throw new Error(`Not implemented yet`)
	}
}
