// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { EvaluationRunner } from './evaluationRunner'
import { InternalManager } from '../expectationManager/internalManager'
import { ExpectationTracker } from '../expectationTracker/expectationTracker'
import { TrackedExpectation } from '../lib/trackedExpectation'

export interface EvaluateContext {
	manager: InternalManager
	tracker: ExpectationTracker
	runner: EvaluationRunner
	trackedExp: TrackedExpectation
	timeSinceLastEvaluation: number
}

export function assertState(
	trackedExp: TrackedExpectation,
	expectState: ExpectedPackageStatusAPI.WorkStatusState
): void {
	if (trackedExp.state !== expectState)
		throw new Error(`Internal Error: The state was supposed to be "${expectState}" but is "${trackedExp.state}"`)
}
