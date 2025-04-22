// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { Reason, stringifyError } from '@sofie-package-manager/api'
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
	// TODO: Some monitor that is able to invalidate if it isn't fulfilled anymore?

	// We don't want to check too often if it's still fulfilled:
	if (timeSinceLastEvaluation > tracker.getFulfilledWaitTime()) {
		await manager.workerAgents.assignWorkerToSession(trackedExp)
		if (trackedExp.session.assignedWorker) {
			try {
				let notFulfilledReason: Reason | null = null

				if (!notFulfilledReason) {
					const waitingFor = tracker.trackedExpectationAPI.isExpectationWaitingForOther(trackedExp)
					if (waitingFor) {
						// Since a dependant is not fulfilled, this one isn't either.
						notFulfilledReason = {
							user: `Waiting for "${waitingFor.exp.statusReport.label}"`,
							tech: `Waiting for "${waitingFor.exp.statusReport.label}"`,
						}
					}
				}

				if (!notFulfilledReason) {
					// Check if it is still fulfilled:
					const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFulfilled(
						trackedExp.exp,
						true
					)
					if (!fulfilled.fulfilled) {
						// It appears like it's not fulfilled anymore
						notFulfilledReason = fulfilled.reason
					}
				}

				if (notFulfilledReason) {
					// If is not fulfilled anymore

					if (trackedExp.exp.workOptions.removePackageOnUnFulfill) {
						const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(
							trackedExp.exp,
							`not fulfilled anymore (${notFulfilledReason.tech})`
						)
						if (!removed.removed) {
							runner.logger.warn(`Unable to remove expectation, reason: ${removed.reason.tech}`)
						}
					}

					trackedExp.status.actualVersionHash = undefined
					trackedExp.status.workProgress = undefined
					tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: notFulfilledReason,
					})
				} else {
					// Yes it is still fulfilled
					// No need to update the tracked state, since it's already fulfilled:
					// this.updateTrackedExp(trackedExp, WorkStatusState.FULFILLED, fulfilled.reason)

					// Update lastEvaluationTime, so that we wait a bit longer before checking again (using tracker.getFulfilledWaitTime()):
					trackedExp.lastEvaluationTime = Date.now()
				}
			} catch (error) {
				runner.logger.warn(`Error in FULFILLED: exp "${trackedExp.id}": ${stringifyError(error)}`)
				// Do nothing, hopefully some will be available at a later iteration
				// todo: Is this the right thing to do?
				tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					reason: {
						user: `Can't check if fulfilled, due to an error`,
						tech: `Error from worker ${trackedExp.session.assignedWorker.id}: ${stringifyError(error)}`,
					},
					dontUpdatePackage: true,
				})
			}
		} else {
			// No worker is available at the moment.
			// Do nothing, hopefully some will be available at a later iteration
			tracker.trackedExpectationAPI.noWorkerAssigned(trackedExp)
		}
	} else {
		// Do nothing
	}
}
