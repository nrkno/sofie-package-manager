import { Expectation } from '@shared/api'
import { GenericWorker } from '../worker'
import { IWorkInProgress } from './workInProgress'

export interface ExpectationHandler {
	doYouSupportExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: any
	) => { support: boolean; reason: string }
	getCostForExpectation: (exp: Expectation.Any, genericWorker: GenericWorker, specificWorker: any) => Promise<number>
	isExpectationReadyToStartWorkingOn: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<{ ready: boolean; reason: string }>
	isExpectationFullfilled: (
		exp: Expectation.Any,
		wasFullfilled: boolean,
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
