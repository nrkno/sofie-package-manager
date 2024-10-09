// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the REMOVED state.
 * The REMOVED state means that the (origin of the) Expectation has been removed.
 * In this state, a worker attempts to remove the Expectation (i.e. removes any artifacts such as files etc).
 * When the removal has finished, the Expectation is marked to be removed completely.
 */
export async function evaluateExpectationStateRemoved({
	manager,
	tracker,
	trackedExp,
}: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.REMOVED)
	/** When true, the expectation can be removed */
	let removeTheExpectation = false

	await manager.workerAgents.assignWorkerToSession(trackedExp)
	if (trackedExp.session.assignedWorker) {
		const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
		// Check if the removal was successful:
		if (removed.removed) {
			removeTheExpectation = true
		} else {
			// Something went wrong when trying to handle the removal.
			trackedExp.errorOnRemoveCount++
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
				reason: removed.reason,
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		trackedExp.errorOnRemoveCount++
		tracker.trackedExpectationAPI.noWorkerAssigned(trackedExp)
	}

	// We only allow a number of failure-of-removals.
	// After that, we'll remove the expectation to avoid congestion:
	if (trackedExp.errorOnRemoveCount > tracker.constants.FAILED_REMOVE_COUNT) {
		removeTheExpectation = true
	}
	if (removeTheExpectation) {
		trackedExp.session.expectationCanBeRemoved = true
		// Send a status that this expectation has been removed:
		tracker.trackedPackageContainerPackageAPI.updatePackageContainerPackageStatus(trackedExp, true)
		manager.callbacks.reportExpectationStatus(trackedExp.id, null, null, {})
	}
}
