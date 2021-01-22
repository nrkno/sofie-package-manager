import { IWorkInProgress } from '../../lib/workInProgress'
import { MessageFromWorker } from '../../../workerAgent'
import { Expectation } from '../../expectationApi'

import { GenericWorker, GenericWorkerConfig, WorkerLocation } from '../../worker'

/** This is a type of worker that runs on a linux machine */
export class LinuxWorker extends GenericWorker {
	constructor(
		public readonly config: LinuxWorkerConfig,
		sendMessageToManager: MessageFromWorker,
		location: WorkerLocation
	) {
		super(config, location, sendMessageToManager, 'linuxWorker')
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
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface LinuxWorkerConfig extends GenericWorkerConfig {
	// TBD
}
