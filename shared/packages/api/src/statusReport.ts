export interface WorkforceStatusReport {
	workerAgents: WorkerStatusReport[]
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
export interface ExpectationManagerStatusReport {
	id: string
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
		workerId: string
	}[]
	worksInProgress: {
		id: string
		lastUpdated: number
		workerId: string
		cost: number
		label: string
		progress: number
		expectationId: string
	}[]
}
export interface WorkerStatusReport {
	id: string
	activeMonitors: {
		containerId: string
		monitorId: string
		label: string
	}[]

	currentJobs: {
		cost: number
		startCost: number
		cancelled: boolean
		wipId: number
		progress: number
		lastUpdated: number
	}[]
}
