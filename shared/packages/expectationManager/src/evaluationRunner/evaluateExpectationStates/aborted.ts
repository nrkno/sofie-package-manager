// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the ABORTED state.
 * The ABORTED state means that a user has clicked "Abort" on the Expectation.
 * An aborted Expectation will stay Aborted until a user clicks "Restart"
 */
export async function evaluateExpectationStateAborted({
	manager,
	tracker,
	trackedExp,
}: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.ABORTED)

	if (!trackedExp.session) trackedExp.session = {}
	await manager.workerAgents.assignWorkerToSession(trackedExp)
	if (trackedExp.session.assignedWorker) {
		// Start by removing the expectation
		const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
		if (removed.removed) {
			// This will cause the expectation to be intentionally stuck in the ABORTED state.
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
				reason: {
					user: 'Aborted',
					tech: 'Aborted',
				},
			})
		} else {
			// Something went wrong when trying to remove
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
				reason: removed.reason,
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		tracker.trackedExpectationAPI.noWorkerAssigned(trackedExp)
	}
}
