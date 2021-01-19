import { Expectation } from '../expectationApi'
import { GenericWorker, IWorkInProgress } from '../worker'

export interface ExpectationHandler {
	isExpectationReadyToStartWorkingOn: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<{ ready: boolean; reason: string }>
	isExpectationFullfilled: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<{ fulfilled: boolean; reason: string }>
	workOnExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<IWorkInProgress>
	removeExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<{ removed: boolean; reason: string }>
}
