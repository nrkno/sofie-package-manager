import { ExpectationManagerWorkerAgent, Reason } from '@sofie-package-manager/api'
import { WorkerAgentAPI } from '../workerAgentApi'

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
