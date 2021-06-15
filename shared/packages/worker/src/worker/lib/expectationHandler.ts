import {
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@shared/api'
import { GenericWorker } from '../worker'
import { IWorkInProgress } from './workInProgress'

export interface ExpectationHandler {
	/**
	 * Does the Expectation-handler supports this expectation?
	 * This includes things like:
	 * * Being able to access/read/write to the sources and targets
	 */
	doYouSupportExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: any
	) => ReturnTypeDoYouSupportExpectation
	/**
	 * Estimate the cost for fulfilling an expectation.
	 * The returned cost is later used to determine which worker is going to get the job.
	 * (lower cost = cheaper/quicker)
	 */
	getCostForExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeGetCostFortExpectation>
	/**
	 * Check if we the start requirements are in place for work on an expectation to start.
	 * If Yes, workOnExpectation() will be called shortly after.
	 */
	isExpectationReadyToStartWorkingOn: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
	/**
	 * Check if the expectation is fulfilled or not.
	 * (If the exopectation is already fullfilled, theres no need to workOnExpectation().)
	 */
	isExpectationFullfilled: (
		exp: Expectation.Any,
		/** If the caller believes that the expectation was fullfilled before */
		wasFullfilled: boolean,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeIsExpectationFullfilled>
	/**
	 * Start working on fullfilling an expectation.
	 * @returns a WorkInProgress, upon beginning of the work. WorkInProgress then handles signalling of the work progress.
	 */
	workOnExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<IWorkInProgress>
	/**
	 * "Make an expectation un-fullfilled"
	 * This is called when an expectation has been removed.
	 */
	removeExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeRemoveExpectation>
}
