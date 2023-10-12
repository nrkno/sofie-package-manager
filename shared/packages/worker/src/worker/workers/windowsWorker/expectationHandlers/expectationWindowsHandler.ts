import { ExpectationHandler } from '../../../lib/expectationHandler'
import {
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@sofie-package-manager/api'
import { GenericWorker } from '../../../worker'
import { WindowsWorker } from '../windowsWorker'
import { IWorkInProgress } from '../../../lib/workInProgress'

export interface ExpectationWindowsHandler extends ExpectationHandler {
	doYouSupportExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => ReturnTypeDoYouSupportExpectation
	getCostForExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		specificWorker: WindowsWorker
	) => Promise<ReturnTypeGetCostFortExpectation>
	isExpectationReadyToStartWorkingOn: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
	isExpectationFullfilled: (
		exp: Expectation.Any,
		wasFullfilled: boolean,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => Promise<ReturnTypeIsExpectationFullfilled>
	workOnExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker,
		/** An FYI, the work will be considered timed out if there are no progression reports within this interval*/
		progressTimeout: number
	) => Promise<IWorkInProgress>
	removeExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => Promise<ReturnTypeRemoveExpectation>
}
