import { Reason } from './methods'

export interface WorkforceStatus {
	workerAgents: {
		id: string
	}[]
	expectationManagers: {
		id: string
		url?: string
	}[]
	appContainers: {
		id: string
		initialized: boolean

		availableApps: {
			appType: string
		}[]
	}[]
}
export interface ExpectationManagerStatus {
	id: string
	expectationStatistics: {
		countTotal: number

		countNew: number
		countWaiting: number
		countReady: number
		countWorking: number
		countFulfilled: number
		countRemoved: number
		countRestarted: number
		countAborted: number
		countNoAvailableWorkers: number
		countError: number
	}
	workerAgents: {
		workerId: string
	}[]
}
// Temporary, release36 only:
export enum StatusCode {
	UNKNOWN = 0, // Status unknown
	GOOD = 1, // All good and green
	WARNING_MINOR = 2, // Everything is not OK, operation is not affected
	WARNING_MAJOR = 3, // Everything is not OK, operation might be affected
	BAD = 4, // Operation affected, possible to recover
	FATAL = 5, // Operation affected, not possible to recover without manual interference
}
// Temporary, release36 only:
export interface PackageContainerStatus {
	status: StatusCode
	statusReason: Reason
	statusChanged: number

	monitors: {
		[monitorId: string]: PackageContainerMonitorStatus
	}
}
// Temporary, release36 only:
export interface PackageContainerMonitorStatus {
	label: string
	status: StatusCode
	statusReason: Reason
}
