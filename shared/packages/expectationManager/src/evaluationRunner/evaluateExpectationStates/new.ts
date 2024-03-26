// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the NEW state.
 * The NEW state is the initial state of an Expectation.
 * In the New state, a check is made to see which Workers are able to support the Expectation.
 * After some Workers has been found, the Expectation is moved to the WAITING state.
 */
export async function evaluateExpectationStateNew({ manager, tracker, trackedExp }: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.NEW)

	// Check which workers might want to handle it:
	// Reset properties:
	trackedExp.status = {}

	const { hasQueriedAnyone, workerCount } = await manager.workerAgents.updateAvailableWorkersForExpectation(
		trackedExp
	)

	const availableWorkersCount = trackedExp.availableWorkers.size
	if (availableWorkersCount > 0) {
		if (hasQueriedAnyone) {
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
				reason: {
					user: `${availableWorkersCount} workers available, about to start...`,
					tech: `Found ${availableWorkersCount} workers who supports this Expectation`,
				},
				// Don't update the package status, since we don't know anything about the package yet:
				dontUpdatePackage: true,
			})
		} else {
			// If we didn't query anyone, just skip ahead to next state without being too verbose:
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
				// Don't update the package status, since we don't know anything about the package yet:
				dontUpdatePackage: true,
			})
		}
	} else {
		if (!trackedExp.queriedWorkers.size) {
			if (!workerCount) {
				tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					reason: {
						user: `No Workers available (this is likely a configuration issue)`,
						tech: `No Workers available`,
					},
					// Don't update the package status, since we don't know anything about the package yet:
					dontUpdatePackage: true,
				})
			} else {
				tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					reason: {
						user: `No Workers available (this is likely a configuration issue)`,
						tech: `No Workers queried, ${workerCount} available`,
					},
					// Don't update the package status, since we don't know anything about the package yet:
					dontUpdatePackage: true,
				})
			}
		} else {
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: `Found no workers who supports this Expectation, due to: ${trackedExp.noAvailableWorkersReason.user}`,
					tech: `Found no workers who supports this Expectation: "${
						trackedExp.noAvailableWorkersReason.tech
					}", have asked workers: [${Array.from(trackedExp.queriedWorkers.keys()).join(',')}]`,
				},
				// Don't update the package status, since we don't know anything about the package yet:
				dontUpdatePackage: true,
			})
		}
	}
}
