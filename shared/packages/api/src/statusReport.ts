import {
	AppContainerId,
	AppType,
	PackageContainerId,
	ExpectationId,
	ExpectationManagerId,
	MonitorId,
	WorkInProgressId,
	WorkerAgentId,
	WorkInProgressLocalId,
} from './ids'

export interface WorkforceStatusReport {
	workerAgents: WorkerStatusReport[]
	expectationManagers: {
		id: ExpectationManagerId
		url?: string
	}[]
	appContainers: {
		id: AppContainerId
		initialized: boolean

		availableApps: {
			appType: AppType
		}[]
	}[]
}
export interface ExpectationManagerStatusReport {
	id: ExpectationManagerId
	updated: number
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
	times: { [key: string]: number }
	workerAgents: {
		workerId: WorkerAgentId
	}[]
	worksInProgress: {
		id: WorkInProgressId
		lastUpdated: number
		workerId: WorkerAgentId
		cost: number
		label: string
		progress: number
		expectationId: ExpectationId
	}[]
}
export interface WorkerStatusReport {
	id: WorkerAgentId
	activeMonitors: {
		containerId: PackageContainerId
		monitorId: MonitorId
		label: string
	}[]

	currentJobs: {
		cost: number
		startCost: number
		cancelled: boolean
		wipId: WorkInProgressLocalId
		progress: number
		lastUpdated: number
	}[]
}
