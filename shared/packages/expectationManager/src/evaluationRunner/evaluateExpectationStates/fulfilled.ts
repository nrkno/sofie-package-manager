// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { stringifyError } from '@sofie-package-manager/api'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the FULFILLED state.
 * The FULFILLED state means that an Expectation is "Done".
 * While in the Fulfilled state, we should periodically check if the Expectation is still Fulfilled.
 * If not Fulfilled anymore, the Expectation will return to the NEW state to be re-evaluated again later.
 */
export async function evaluateExpectationStateFulfilled({
	manager,
	tracker,
	runner,
	trackedExp,
	timeSinceLastEvaluation,
}: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.FULFILLED)
	// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore?

	if (timeSinceLastEvaluation > tracker.getFullfilledWaitTime()) {
		if (!trackedExp.session) trackedExp.session = {}
		await manager.assignWorkerToSession(trackedExp)
		if (trackedExp.session.assignedWorker) {
			try {
				// Check if it is still fulfilled:
				const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFullfilled(
					trackedExp.exp,
					true
				)
				if (fulfilled.fulfilled) {
					// Yes it is still fullfiled
					// No need to update the tracked state, since it's already fullfilled:
					// this.updateTrackedExp(trackedExp, WorkStatusState.FULFILLED, fulfilled.reason)
				} else {
					// It appears like it's not fullfilled anymore
					trackedExp.status.actualVersionHash = undefined
					trackedExp.status.workProgress = undefined
					tracker.updateTrackedExpectationStatus(trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: fulfilled.reason,
					})
				}
			} catch (error) {
				runner.logger.warn(`Error in FULFILLED: ${stringifyError(error)}`)
				// Do nothing, hopefully some will be available at a later iteration
				// todo: Is this the right thing to do?
				tracker.updateTrackedExpectationStatus(trackedExp, {
					reason: {
						user: `Can't check if fulfilled, due to an error`,
						tech: `Error from worker ${trackedExp.session.assignedWorker.id}: ${stringifyError(error)}`,
					},
					// Should we se this here?
					// dontUpdatePackage: true,
				})
			}
		} else {
			// No worker is available at the moment.
			// Do nothing, hopefully some will be available at a later iteration
			tracker.noWorkerAssigned(trackedExp)
		}
	} else {
		// Do nothing
	}
}
