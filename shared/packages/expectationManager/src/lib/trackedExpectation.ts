// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { Expectation, ExpectationId, Reason, WorkerAgentId, stringMaxLength } from '@sofie-package-manager/api'
import { ExpectationStateHandlerSession } from '../lib/types'
import { ExpectationTrackerConstants } from './constants'

/** Persistant data structure used to track the progress of an Expectation */
export interface TrackedExpectation {
	/** Unique ID of the tracked expectation */
	id: ExpectationId
	/** The Expectation */
	exp: Expectation.Any

	/** The current State of the expectation. */
	state: ExpectedPackageStatusAPI.WorkStatusState
	/** Reason for the current state. */
	reason: Reason

	/** Previous reasons, for each state. */
	prevStatusReasons: { [status: string]: Reason }

	/** List of worker ids that have gotten the question wether they support this expectation */
	queriedWorkers: Map<WorkerAgentId, number>
	/** List of worker ids that supports this Expectation */
	availableWorkers: Set<WorkerAgentId>
	/** Contains the latest reason why a worker refused to support an Expectation */
	noAvailableWorkersReason: Reason
	/** Timestamp of the last time the expectation was evaluated. */
	lastEvaluationTime: number
	/** Timestamp to track how long the expectation has been waiting for a worker (can't start working), used to request more resources */
	waitingForWorkerTime: number | null
	/** Timestamp to track  how long the expectation has been waiting for a worker, used to restart to re-query for workers */
	noWorkerAssignedTime: number | null
	/** The number of times the expectation has failed */
	errorCount: number
	/** When set, contains info about the last error that happened on the expectation. */
	lastError: {
		/** Timestamp of the last error */
		time: number
		/** Explanation of what the last error was */
		reason: Reason
	} | null
	/** How many times the Expectation failed to be Removed */
	errorOnRemoveCount: number

	/** These statuses are sent from the workers */
	status: {
		workProgress?: number
		// workInProgress?: IWorkInProgress
		workInProgressCancel?: () => Promise<void>
		actualVersionHash?: string | null

		sourceExists?: boolean
		targetCanBeUsedWhileTransferring?: boolean
		sourceIsPlaceholder?: boolean
	}
	/** A storage which is persistant only for a short while, during an evaluation of the Expectation. */
	session: ExpectationStateHandlerSession | null
}

export function expLabel(exp: TrackedExpectation): string {
	return stringMaxLength(exp.id, 16) + ' ' + stringMaxLength(exp.exp.statusReport.label, 80)
}

export function sortTrackedExpectations(
	trackedExpectations: Map<ExpectationId, TrackedExpectation>,
	constants: ExpectationTrackerConstants
): TrackedExpectation[] {
	const tracked: TrackedExpectation[] = Array.from(trackedExpectations.values())
	tracked.sort((a, b) => {
		const aLastErrorTime: number = a.lastError?.time ?? 0
		const bLastErrorTime: number = b.lastError?.time ?? 0

		// If the expectation had an error recently, it should be prioritized down:
		const aHadRecentError: boolean = Date.now() - aLastErrorTime < constants.ERROR_WAIT_TIME
		const bHadRecentError: boolean = Date.now() - bLastErrorTime < constants.ERROR_WAIT_TIME

		if (aHadRecentError && !bHadRecentError) return 1
		if (!aHadRecentError && bHadRecentError) return -1

		// Lowest priority first
		if (a.exp.priority > b.exp.priority) return 1
		if (a.exp.priority < b.exp.priority) return -1

		// Lowest lastErrorTime first, this is to make it so that if one expectation fails, it'll not block all the others
		if (aLastErrorTime > bLastErrorTime) return 1
		if (aLastErrorTime < bLastErrorTime) return -1

		// Lowest lastOperationTime first
		if (a.lastEvaluationTime > b.lastEvaluationTime) return 1
		if (a.lastEvaluationTime < b.lastEvaluationTime) return -1

		return 0
	})
	return tracked
}
export function getDefaultTrackedExpectation(
	exp: Expectation.Any,
	existingtrackedExp?: TrackedExpectation
): TrackedExpectation {
	return {
		id: exp.id,
		exp: exp,
		state: existingtrackedExp?.state || ExpectedPackageStatusAPI.WorkStatusState.NEW,
		queriedWorkers: new Map(),
		availableWorkers: new Set(),
		noAvailableWorkersReason: {
			user: 'Unknown reason',
			tech: 'N/A (init)',
		},
		lastEvaluationTime: 0,
		waitingForWorkerTime: null,
		noWorkerAssignedTime: null,
		errorCount: 0,
		lastError: null,
		errorOnRemoveCount: 0,
		reason: {
			user: '',
			tech: '',
		},
		prevStatusReasons: existingtrackedExp?.prevStatusReasons || {},
		status: {},
		session: null,
	}
}
