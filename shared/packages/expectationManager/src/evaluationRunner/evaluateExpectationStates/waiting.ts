// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { stringifyError } from '@sofie-package-manager/api'
import { TrackedExpectation } from '../../lib/trackedExpectation'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the WAITING state.
 * The WAITING state means that an Expectation is waiting to be started working on.
 * When the Expectation is Ready to start workin on, it will be moved to the state READY.
 * Or, if it turns out that the Expectation is already Fulfilled, it will be moved to FULFILLED right away.
 */
export async function evaluateExpectationStateWaiting({
	manager,
	tracker,
	runner,
	trackedExp,
}: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.WAITING)

	// Check if the expectation is ready to start:
	await manager.workerAgents.assignWorkerToSession(trackedExp)

	if (trackedExp.session.assignedWorker) {
		try {
			// First check if the Expectation depends on the fulfilled-status of another Expectation:
			const isWaitingForOther = tracker.trackedExpectationAPI.isExpectationWaitingForOther(trackedExp)

			if (isWaitingForOther) {
				// Not ready to start because it's waiting for another expectation to be fulfilled first
				// Stay here in WAITING state:
				tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					reason: {
						user: `Waiting for "${isWaitingForOther.exp.statusReport.label}"`,
						tech: `Waiting for "${isWaitingForOther.exp.statusReport.label}"`,
					},
				})

				return
			}

			// First, check if it is already fulfilled:
			const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFulfilled(
				trackedExp.exp,
				false
			)
			if (fulfilled.fulfilled) {
				// The expectation is already fulfilled:

				tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
				})
				if (tracker.trackedExpectationAPI.onExpectationFulfilled(trackedExp)) {
					// Something was triggered, run again ASAP:
					trackedExp.session.triggerOtherExpectationsAgain = true
				}
				return
			}
			const readyToStart = await tracker.trackedExpectationAPI.isExpectationReadyToStartWorkingOn(
				trackedExp.session.assignedWorker.worker,
				trackedExp
			)

			const newStatus: Partial<TrackedExpectation['status']> = {}
			{
				const sourceExists = readyToStart.ready || readyToStart.sourceExists
				if (sourceExists !== undefined) newStatus.sourceExists = sourceExists
			}
			{
				const isPlaceholder = readyToStart.ready ? false : readyToStart.isPlaceholder
				if (isPlaceholder !== undefined) newStatus.sourceIsPlaceholder = isPlaceholder
			}

			if (readyToStart.ready) {
				tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.READY,
					reason: {
						user: 'About to start working..',
						tech: `About to start, was not fulfilled: ${fulfilled.reason.tech}`,
					},
					status: newStatus,
				})
			} else {
				// Not ready to start because of some reason (e.g. the source doesn't exist)
				// Stay here in WAITING state:
				tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
					reason: readyToStart.reason,
					status: newStatus,
				})
			}
		} catch (error) {
			// There was an error, clearly it's not ready to start
			runner.logger.warn(`Error in WAITING: exp "${trackedExp.id}": ${stringifyError(error)}`)

			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: 'Restarting due to error',
					tech: `Error from worker ${trackedExp.session.assignedWorker.id}: "${stringifyError(error)}"`,
				},
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Do nothing, hopefully some will be available at a later iteration
		tracker.trackedExpectationAPI.noWorkerAssigned(trackedExp)
	}
}
