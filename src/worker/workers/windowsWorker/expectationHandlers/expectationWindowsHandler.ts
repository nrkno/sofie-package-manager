import { ExpectationHandler } from '../../../lib/expectationHandler'
import { Expectation } from '../../../expectationApi'
import { GenericWorker } from '../../../worker'
import { WindowsWorker } from '../windowsWorker'
import { IWorkInProgress } from '../../../lib/workInProgress'

export interface ExpectationWindowsHandler extends ExpectationHandler {
	isExpectationReadyToStartWorkingOn: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => Promise<{ ready: boolean; reason: string }>
	isExpectationFullfilled: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => Promise<{ fulfilled: boolean; reason: string }>
	workOnExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => Promise<IWorkInProgress>
	removeExpectation: (
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	) => Promise<{ removed: boolean; reason: string }>
}
