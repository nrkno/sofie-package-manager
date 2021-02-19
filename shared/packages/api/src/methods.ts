/* eslint-disable @typescript-eslint/no-namespace */
import { Expectation } from './expectationApi'
import {
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from './worker'

/** Methods used by ExpectationManager and WorkForce */
export namespace WorkForceExpectationManager {
	/** Methods on WorkForce, called by ExpectationManager */
	export interface WorkForce {
		registerExpectationManager: (managerId: string, url: string) => Promise<void>
	}
	/** Methods on ExpectationManager, called by WorkForce */
	// eslint-disable-next-line @typescript-eslint/no-empty-interface
	export interface ExpectationManager {}
}

/** Methods used by WorkForce and WorkerAgent */
export namespace WorkForceWorkerAgent {
	/** Methods on WorkerAgent, called by WorkForce */
	export interface WorkerAgent {
		expectationManagerAvailable: (id: string, url: string) => Promise<void>
		expectationManagerGone: (id: string) => Promise<void>
	}
	/** Methods on WorkForce, called by WorkerAgent */
	export interface WorkForce {
		getExpectationManagerList: () => Promise<{ id: string; url: string }[]>
	}
}

/** Methods used by ExpectedManager and WorkerAgent */
export namespace ExpectationManagerWorkerAgent {
	/** Methods on WorkerAgent, called by ExpectedManager */
	export interface WorkerAgent {
		doYouSupportExpectation: (exp: Expectation.Any) => Promise<ReturnTypeDoYouSupportExpectation>
		getCostForExpectation: (exp: Expectation.Any) => Promise<ExpectationCost>
		isExpectationReadyToStartWorkingOn: (
			exp: Expectation.Any
		) => Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
		isExpectationFullfilled: (
			exp: Expectation.Any,
			wasFullfilled: boolean
		) => Promise<ReturnTypeIsExpectationFullfilled>
		workOnExpectation: (exp: Expectation.Any, cost: ExpectationCost) => Promise<WorkInProgressInfo>
		removeExpectation: (exp: Expectation.Any) => Promise<ReturnTypeRemoveExpectation>

		cancelWorkInProgress: (wipId: number) => Promise<void>
	}
	/** Methods on ExpectedManager, called by WorkerAgent */
	export interface ExpectationManager {
		messageFromWorker: (message: MessageFromWorkerPayload) => Promise<any>

		// Events emitted from a workInProgress:
		wipEventProgress: (wipId: number, actualVersionHash: string | null, progress: number) => Promise<void>
		wipEventDone: (wipId: number, actualVersionHash: string, reason: string, result: any) => Promise<void>
		wipEventError: (wipId: number, error: string) => Promise<void>
	}
	export interface WorkInProgressInfo {
		wipId: number
		properties: WorkInProgressProperties
	}
	export interface WorkInProgressProperties {
		workLabel: string
		targetCanBeUsedWhileTransferring?: boolean
	}

	export interface ExpectationCost {
		/** Cost for working on the Expectation */
		cost: number
		/** Cost "in queue" until working on the Expectation can start */
		startCost: number
	}
	export type MessageFromWorker = (managerId: string, message: MessageFromWorkerPayload) => Promise<any>
	export type MessageFromWorkerSerialized = (message: MessageFromWorkerPayload) => Promise<ReplyToWorker>
	export interface MessageFromWorkerPayload {
		type: string
		arguments: any[]
	}

	export interface ReplyToWorker {
		error?: string
		result?: any
	}
}
