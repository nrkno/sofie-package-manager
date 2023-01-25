// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the RESTARTED state.
 * The RESTARTED state means that a user has clicked "Restart" on the Expectation.
 */
export async function evaluateExpectationStateRestarted({
	manager,
	tracker,
	trackedExp,
}: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.RESTARTED)

	if (!trackedExp.session) trackedExp.session = {}
	await manager.workerAgents.assignWorkerToSession(trackedExp)
	if (trackedExp.session.assignedWorker) {
		// Start by removing the expectation
		const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
		if (removed.removed) {
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: 'Ready to start (after restart)',
					tech: 'Ready to start (after restart)',
				},
			})
		} else {
			// Something went wrong when trying to remove
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
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
