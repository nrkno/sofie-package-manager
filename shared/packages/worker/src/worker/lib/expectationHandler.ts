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
	doYouSupportExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: any
	) => ReturnTypeDoYouSupportExpectation
	getCostForExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeGetCostFortExpectation>
	isExpectationReadyToStartWorkingOn: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
	isExpectationFullfilled: (
		exp: Expectation.Any,
		wasFullfilled: boolean,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeIsExpectationFullfilled>
	workOnExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<IWorkInProgress>
	removeExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: any
	) => Promise<ReturnTypeRemoveExpectation>
}
