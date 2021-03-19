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
import { IWorkInProgress } from './lib/workInProgress'

/**
 * A Worker runs static stateless/lambda functions.
 */
export abstract class GenericWorker {
	/** A space where the AccessorHandlers can store various things, such as persistant connections, etc.. */
	public accessorCache: { [accessorType: string]: unknown } = {}

	constructor(
		public readonly genericConfig: WorkerAgentConfig,
		public readonly location: WorkerLocation,
		public sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker,
		public type: string
	) {}
	/**
	 * Does the worker supports this expectation?
	 * This includes things like:
	 * * Being able to access/read/write to the sources and targets
	 */
	abstract doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation>
	/**
	 * Estimate the cost for fulfilling an expectation.
	 * The returned cost is later used to determine which worker is going to get the job.
	 * (lower cost = cheaper/quicker)
	 */
	abstract getCostFortExpectation(exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation>
	/**
	 * Check if we the start requirements are in place for work on an expectation to start.
	 * If Yes, workOnExpectation() will be called shortly after.
	 */
	abstract isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
	/**
	 * Check if the expectation is fulfilled or not.
	 * (If the exopectation is already fullfilled, theres no need to workOnExpectation().)
	 */
	abstract isExpectationFullfilled(
		exp: Expectation.Any,
		wasFullfilled: boolean
	): Promise<ReturnTypeIsExpectationFullfilled>
	/**
	 * Start working on fullfilling an expectation.
	 * @returns a WorkInProgress, upon beginning of the work. WorkInProgress then handles signalling of the work progress.
	 */
	abstract workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress>
	/**
	 * "Make an expectation un-fullfilled"
	 * This is called when an expectation has been removed.
	 */
	abstract removeExpectation(exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation>
}
export interface WorkerLocation {
	/** The name/identifier of the computer that this runs on */
	localComputerId?: string
	/** The names/identifiers of the local network that this has access to */
	localNetworkIds: string[]
}
