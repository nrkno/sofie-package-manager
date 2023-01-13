import { Expectation, ExpectationManagerWorkerAgent, Reason } from '@sofie-package-manager/api'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { WorkerAgentAPI } from '../workerAgentApi'

export interface TrackedExpectation {
	/** Unique ID of the tracked expectation */
	id: string
	/** The Expectation */
	exp: Expectation.Any

	/** The current State of the expectation. */
	state: ExpectedPackageStatusAPI.WorkStatusState
	/** Reason for the current state. */
	reason: Reason

	/** Previous reasons, for each state. */
	prevStatusReasons: { [status: string]: Reason }

	/** List of worker ids that have gotten the question wether they support this expectation */
	queriedWorkers: { [workerId: string]: number }
	/** List of worker ids that supports this Expectation */
	availableWorkers: { [workerId: string]: true }
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
		sourceIsPlaceholder?: boolean // todo: to be implemented (quantel)
	}
	/** A storage which is persistant only for a short while, during an evaluation of the Expectation. */
	session: ExpectationStateHandlerSession | null
}
/** Contains some data which is persisted during an evaluation-session */
export interface ExpectationStateHandlerSession {
	/** Set to true if the other tracked expectations should be triggered again ASAP */
	triggerOtherExpectationsAgain?: boolean
	/** Set to true when the tracked expectation can safely be removed */
	expectationCanBeRemoved?: boolean

	/** If there was an unexpected error */
	hadError?: boolean

	/** The Worker assigned to the Expectation during this evaluation-session */
	assignedWorker?: WorkerAgentAssignment
	noAssignedWorkerReason?: Reason
}
export interface WorkerAgentAssignment {
	worker: WorkerAgentAPI
	id: string
	cost: ExpectationManagerWorkerAgent.ExpectationCost
	randomCost: number
}
