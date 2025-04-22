import {
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { IWorkInProgress } from './workInProgress'

export interface ExpectationHandler<TWorker extends BaseWorker> {
	/**
	 * Does the Expectation-handler supports this expectation?
	 * This includes things like:
	 * * Being able to access/read/write to the sources and targets
	 */
	doYouSupportExpectation: (exp: Expectation.Any, worker: TWorker) => ReturnTypeDoYouSupportExpectation
	/**
	 * Estimate the cost for fulfilling an expectation.
	 * The returned cost is later used to determine which worker is going to get the job.
	 * (lower cost = cheaper/quicker)
	 */
	getCostForExpectation: (exp: Expectation.Any, worker: TWorker) => Promise<ReturnTypeGetCostFortExpectation>
	/**
	 * Check if we the start requirements are in place for work on an expectation to start.
	 * If Yes, workOnExpectation() will be called shortly after.
	 */
	isExpectationReadyToStartWorkingOn: (
		exp: Expectation.Any,
		worker: TWorker
	) => Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
	/**
	 * Check if the expectation is fulfilled or not.
	 * (If the expectation is already fulfilled, theres no need to workOnExpectation().)
	 */
	isExpectationFulfilled: (
		exp: Expectation.Any,
		/** If the caller believes that the expectation was fulfilled before */
		wasFulfilled: boolean,
		worker: TWorker
	) => Promise<ReturnTypeIsExpectationFulfilled>
	/**
	 * Start working on fulfilling an expectation.
	 * The function returns a WorkInProgress, which then handles the actual work asynchronously.
	 * The returned WorkInProgress is expected to emit 'progress'-events at some interval, to indicate that the work is progressing
	 * (otherwise the work will be considered timed out and will be cancelled).
	 */
	workOnExpectation: (
		exp: Expectation.Any,
		worker: TWorker,
		/** An FYI, the work will be considered timed out if there are no progression reports within this interval*/
		progressTimeout: number
	) => Promise<IWorkInProgress>
	/**
	 * "Make an expectation un-fulfilled"
	 * This is called when an expectation has been removed.
	 */
	removeExpectation: (exp: Expectation.Any, reason: string, worker: TWorker) => Promise<ReturnTypeRemoveExpectation>
}
