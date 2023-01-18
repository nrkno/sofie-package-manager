import { WorkerAgentAPI } from '../workerAgentApi'

/** Storage for WorkerAgents */
export class TrackedWorkerAgents {
	private workerAgents: {
		[workerId: string]: TrackedWorkerAgent
	} = {}

	public get(workerId: string): TrackedWorkerAgent | undefined {
		return this.workerAgents[workerId]
	}
	public list(): { workerId: string; workerAgent: TrackedWorkerAgent }[] {
		return Object.entries(this.workerAgents).map(([workerId, workerAgent]) => {
			return {
				workerId,
				workerAgent,
			}
		})
	}
	public upsert(workerId: string, workerAgent: TrackedWorkerAgent): void {
		this.workerAgents[workerId] = workerAgent
	}
	public remove(workerId: string): void {
		delete this.workerAgents[workerId]
	}
}

export interface TrackedWorkerAgent {
	api: WorkerAgentAPI
	connected: boolean
}
