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
