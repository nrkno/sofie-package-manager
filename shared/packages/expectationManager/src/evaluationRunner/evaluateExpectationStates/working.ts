// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the WORKING state.
 * The WORKING state means that the Expectation is currently being worked on by a Worker.
 * There isn't much being done in this state. Instead, as the work progresses, events are being sent by the Worker
 * to a Work-in-progress, tracked in the WorkInProgressTracker.
 * When a "done" event is sent, the Expectation is moved to the state FULFILLED.
 */
export async function evaluateExpectationStateWorking({ trackedExp }: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.WORKING)

	// It is already working, don't do anything
	// TODO: work-timeout?
}
