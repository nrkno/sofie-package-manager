// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { LoggerInstance, Reason, ReturnTypeIsExpectationReadyToStartWorkingOn } from '@sofie-package-manager/api'
import _ from 'underscore'

import { TrackedExpectation, expLabel } from '../../lib/trackedExpectation'
import { WorkerAgentAPI } from '../../workerAgentApi'
import { ExpectationTracker } from '../expectationTracker'

/** Various methods related to TrackedExpectation */
export class TrackedExpectationAPI {
	private logger: LoggerInstance

	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('TrackedExpectationAPI')
	}

	/** Update the state and status of a trackedExpectation */
	public updateTrackedExpectationStatus(
		trackedExp: TrackedExpectation,
		upd: {
			/** If set, sets a new state of the Expectation */
			state?: ExpectedPackageStatusAPI.WorkStatusState
			/** If set, sets a new reason of the Expectation */
			reason?: Reason
			/** If set, sets new status properties of the expectation */
			status?: Partial<TrackedExpectation['status']> | undefined
			/** Whether the new state is due an error or not */
			isError?: boolean
			/**
			 * If set, the package on packageContainer status won't be updated.
			 * This is used to defer updates in situations where we don't really know what the status of the package is.
			 * */
			dontUpdatePackage?: boolean
		}
	): void {
		const { state, reason, status, isError, dontUpdatePackage } = upd

		trackedExp.lastEvaluationTime = Date.now()
		if (isError) {
			trackedExp.lastError = {
				time: Date.now(),
				reason: reason || { user: 'Unknown error', tech: 'Unknown error' },
			}
			if (trackedExp.session) trackedExp.session.hadError = true
		}

		const prevState: ExpectedPackageStatusAPI.WorkStatusState = trackedExp.state
		const prevReason: Reason = trackedExp.reason

		let updatedState = false
		let updatedReason = false
		let updatedStatus = false

		if (state !== undefined && trackedExp.state !== state) {
			trackedExp.state = state
			updatedState = true
		}

		if (reason && !_.isEqual(trackedExp.reason, reason)) {
			trackedExp.reason = reason
			updatedReason = true
		}
		if (updatedState || updatedReason) {
			trackedExp.prevStatusReasons[prevState] = {
				user: prevReason.user,
				tech: `${prevReason.tech} | ${new Date().toLocaleTimeString()}`,
			}
		}

		if (status) {
			const newStatus = Object.assign({}, trackedExp.status, status) // extend with new values
			if (!_.isEqual(trackedExp.status, newStatus)) {
				Object.assign(trackedExp.status, status)
				updatedStatus = true
			}
		}
		// Log and report new states an reasons:
		if (updatedState && updatedReason) {
			this.logger.debug(
				`${expLabel(trackedExp)}: New state: "${prevState}"->"${trackedExp.state}", reason: "${
					trackedExp.reason.tech
				}"`
			)
		} else if (updatedState) {
			this.logger.debug(`${expLabel(trackedExp)}: New state: "${prevState}"->"${trackedExp.state}"`)
		} else if (updatedReason) {
			this.logger.debug(
				`${expLabel(trackedExp)}: State: "${trackedExp.state}", New reason: "${trackedExp.reason.tech}"`
			)
		}

		if (updatedState || updatedReason || updatedStatus) {
			this.tracker.callbacks.reportExpectationStatus(trackedExp.id, trackedExp.exp, null, {
				progress: trackedExp.status.workProgress || 0,
				priority: trackedExp.exp.priority,
				status: updatedState || updatedReason ? trackedExp.state : undefined,
				statusReason: updatedReason ? trackedExp.reason : undefined,
				prevStatusReasons: trackedExp.prevStatusReasons,
			})
		}
		if (!dontUpdatePackage) {
			if (updatedState || updatedReason || updatedStatus) {
				this.tracker.trackedPackageContainerPackageAPI.updatePackageContainerPackageStatus(trackedExp, false)
			}
		}
	}
	/** Calls workerAgent.isExpectationReadyToStartWorkingOn() */
	public async isExpectationReadyToStartWorkingOn(
		workerAgent: WorkerAgentAPI,
		trackedExp: TrackedExpectation
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		// First check if the Expectation depends on the fulfilled-status of another Expectation:
		const waitingFor = this.isExpectationWaitingForOther(trackedExp)

		if (waitingFor) {
			return {
				ready: false,
				reason: {
					user: `Waiting for "${waitingFor.exp.statusReport.label}"`,
					tech: `Waiting for "${waitingFor.exp.statusReport.label}"`,
				},
				isWaitingForAnother: true,
			}
		}

		return workerAgent.isExpectationReadyToStartWorkingOn(trackedExp.exp)
	}
	/** Checks if the expectation is waiting for another expectation, and returns the awaited Expectation, otherwise null */
	public isExpectationWaitingForOther(trackedExp: TrackedExpectation): TrackedExpectation | null {
		if (trackedExp.exp.dependsOnFulfilled?.length) {
			// Check if those are fulfilled:
			let waitingFor: TrackedExpectation | undefined = undefined
			for (const id of trackedExp.exp.dependsOnFulfilled) {
				const trackedExp = this.tracker.trackedExpectations.get(id)
				if (trackedExp && trackedExp.state !== ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
					waitingFor = trackedExp
					break
				}
			}
			if (waitingFor) {
				return waitingFor
			}
		}
		return null
	}
	/**
	 * To be called when trackedExp.status turns fulfilled.
	 * Triggers any other expectations that listens to (are dependant on) the fulfilled one.
	 * @returns true if any other expectations where triggered (ie evaluation should run again ASAP)
	 */
	public onExpectationFulfilled(fulfilledExp: TrackedExpectation): boolean {
		let hasTriggeredSomething = false
		if (fulfilledExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
			const expectationsToTrigger = this.tracker.listeningExpectations.getListeningExpectations(fulfilledExp.id)

			// Go through the listening expectations and mark them to be re-evaluated ASAP:
			for (const id of expectationsToTrigger) {
				const toTriggerExp = this.tracker.trackedExpectations.get(id)
				if (toTriggerExp) {
					toTriggerExp.lastEvaluationTime = 0 // so that it reruns ASAP
					hasTriggeredSomething = true
				}
			}
		}
		return hasTriggeredSomething
	}

	/**
	 * Handle an Expectation that had no worker assigned
	 */
	public noWorkerAssigned(trackedExp: TrackedExpectation): void {
		if (!trackedExp.session) throw new Error('Internal error: noWorkerAssigned: session not set')
		if (trackedExp.session.assignedWorker)
			throw new Error('Internal error: noWorkerAssigned can only be called when assignedWorker is falsy')

		let noAssignedWorkerReason: ExpectedPackageStatusAPI.Reason
		if (!trackedExp.session.noAssignedWorkerReason) {
			this.logger.error(
				`trackedExp.session.noAssignedWorkerReason is undefined, although assignedWorker was set..`
			)
			noAssignedWorkerReason = {
				user: 'Unknown reason (internal error)',
				tech: 'Unknown reason',
			}
		} else {
			noAssignedWorkerReason = trackedExp.session.noAssignedWorkerReason
		}

		if (!trackedExp.noWorkerAssignedTime) trackedExp.noWorkerAssignedTime = Date.now()

		// Special case: When WAITING and no worker was assigned, return to NEW so that another worker might be assigned:
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
			this.updateTrackedExpectationStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: noAssignedWorkerReason,
				// Don't update the package status, since this means that we don't know anything about the package:
				dontUpdatePackage: true,
			})
		} else {
			// only update the reason
			this.updateTrackedExpectationStatus(trackedExp, {
				reason: noAssignedWorkerReason,
				// Don't update the package status, since this means that we don't know anything about the package:
				dontUpdatePackage: true,
			})
		}
	}
}
