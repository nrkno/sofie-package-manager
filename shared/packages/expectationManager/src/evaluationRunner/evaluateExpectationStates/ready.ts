// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { valueOfCost, stringifyError } from '@sofie-package-manager/api'
import { expLabel } from '../../lib/trackedExpectation'
import { assertState, EvaluateContext } from '../lib'

/**
 * Evaluate a TrackedExpectation which is in the READY state.
 * The READY state means that an Expectation is just about to start being worked on.
 * When a Worker is found to be free to start working, the work is started and the Expectation is moved to the WORKING state.
 */
export async function evaluateExpectationStateReady({
	manager,
	tracker,
	runner,
	trackedExp,
}: EvaluateContext): Promise<void> {
	assertState(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.READY)
	// Start working on it:
	if (!trackedExp.session) trackedExp.session = {}
	await manager.workerAgents.assignWorkerToSession(trackedExp)

	if (
		trackedExp.session.assignedWorker &&
		// Only allow starting if the job can start in a short while:
		valueOfCost(trackedExp.session.assignedWorker.cost.startCost) > 0 // 2022-03-25: We're setting this to 0 to only allow one job per worker
	) {
		trackedExp.session.noAssignedWorkerReason = {
			user: `Workers are busy`,
			tech: `Workers are busy (startCost=${trackedExp.session.assignedWorker.cost.startCost})`,
		}
		delete trackedExp.session.assignedWorker
	}
	if (trackedExp.session.assignedWorker) {
		const assignedWorker = trackedExp.session.assignedWorker

		try {
			runner.logger.debug(`workOnExpectation: "${expLabel(trackedExp)}" (${trackedExp.exp.type})`)

			// Start working on the Expectation:
			const wipInfo = await assignedWorker.worker.workOnExpectation(
				trackedExp.exp,
				assignedWorker.cost,
				tracker.constants.WORK_TIMEOUT_TIME
			)

			trackedExp.status.workInProgressCancel = async () => {
				await assignedWorker.worker.cancelWorkInProgress(wipInfo.wipId)
				delete trackedExp.status.workInProgressCancel
			}

			// trackedExp.status.workInProgress = new WorkInProgressReceiver(wipInfo.properties)
			tracker.worksInProgress.upsert(assignedWorker.id, wipInfo.wipId, {
				wipId: wipInfo.wipId,
				properties: wipInfo.properties,
				trackedExp: trackedExp,
				workerId: assignedWorker.id,
				worker: assignedWorker.worker,
				cost: assignedWorker.cost.cost,
				startCost: assignedWorker.cost.startCost,
				lastUpdated: Date.now(),
			})

			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.WORKING,
				reason: {
					user: `Working on: ${wipInfo.properties.workLabel}`,
					tech: `Working on: ${wipInfo.properties.workLabel}`,
				},
				status: wipInfo.properties,
			})
		} catch (error) {
			runner.logger.warn(`Error in READY: exp "${trackedExp.id}": ${stringifyError(error)}`)
			// There was an error
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: {
					user: 'Restarting due to an error',
					tech: `Error from worker ${trackedExp.session.assignedWorker.id}: "${stringifyError(error)}"`,
				},
				isError: true,
			})
		}
	} else {
		// No worker is available at the moment.
		// Check if enough time has passed if it makes sense to check for new workers again:

		if (
			trackedExp.noWorkerAssignedTime &&
			Date.now() - trackedExp.noWorkerAssignedTime > tracker.constants.WORKER_SUPPORT_TIME
		) {
			// Restart
			tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				// Don't update the package status, since we don't know anything about the package at this point:
				dontUpdatePackage: true,
			})
		} else {
			// Do nothing, hopefully some will be available at a later iteration
			tracker.trackedExpectationAPI.noWorkerAssigned(trackedExp)
		}
	}
}
