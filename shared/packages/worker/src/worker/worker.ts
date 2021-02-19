import {
	Expectation,
	ExpectationManagerWorkerAgent,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@shared/api'
import { IWorkInProgress } from './lib/workInProgress'

/**
 * A Worker runs static stateless/lamda functions.
 */
export abstract class GenericWorker {
	constructor(
		_config: GenericWorkerConfig,
		public readonly location: WorkerLocation,
		public sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker,
		public type: string
	) {}
	/**
	 * A check if the worker supports fulfilling the Expectation at all
	 */
	abstract doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation>
	/**
	 * Get cost for the Expectation. This is used to determine which worker is going to get the job.
	 */
	abstract getCostFortExpectation(exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation>
	/**
	 * A check if it is possible to start working on the Expectation.
	 */
	abstract isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
	/**
	 * A check if the Expectation is fullfilled.
	 * If this is true, the Expectation needs not to be started working on.
	 */
	abstract isExpectationFullfilled(
		exp: Expectation.Any,
		wasFullfilled: boolean
	): Promise<ReturnTypeIsExpectationFullfilled>
	/**
	 * Tells the Worker to start working on fullfilling the Expectation.
	 */
	abstract workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress>
	/**
	 * Tells the Worker that an Expectation has been removed
	 * Returns { removed: true } if the artifacts have successfully been dealt with
	 */
	abstract removeExpectation(exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation>
}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GenericWorkerConfig {
	// empty?
}
export interface WorkerLocation {
	/** The name/identifier of the computer that this runs on */
	localComputerId?: string
	/** The names/identifiers of the local network that this has access to */
	localNetworkIds: string[]
}
