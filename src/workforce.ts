import { MessageFromWorker, MessageFromWorkerPayload, WorkerAgent } from './workerAgent'

export class Workforce {
	private i = 0
	private workerAgents: { [id: string]: TrackedWorkerAgent } = {}

	constructor(private onMessageFromWorker: MessageFromWorker) {}

	async init(): Promise<void> {
		// todo: handle spinning up of worker agents intelligently
		// tmp:
		await this.addWorkerAgent()
		await this.addWorkerAgent()
		await this.addWorkerAgent()
	}
	public getAllWorkerAgents(): WorkerAgent[] {
		return Object.values(this.workerAgents).map((w) => w.worker)
	}
	public getWorkerAgent(id: string): TrackedWorkerAgent | undefined {
		return this.workerAgents[id]
	}
	// getWorkerAgentIds(): string[] {
	// 	return Object.keys(this.workerAgents)
	// }

	// getNextFreeWorker(ids: string[]): WorkerAgent | undefined {
	// 	for (const id of ids) {
	// 		const workerAgent = this.getWorkerAgent(id)
	// 		if (workerAgent && workerAgent.isFree()) {
	// 			return workerAgent
	// 		}
	// 	}
	// 	return undefined
	// }
	private async addWorkerAgent(): Promise<string> {
		const id = 'agent' + this.i++

		const worker = new WorkerAgent(id, async (message: MessageFromWorkerPayload) => {
			try {
				return { error: undefined, result: await this.onMessageFromWorker(message) }
			} catch (error) {
				return { error: typeof error === 'string' ? error : error.message || error.reason || error.toString() }
			}
		})

		this.workerAgents[id] = {
			worker: worker,
		}

		return id
	}
}

interface TrackedWorkerAgent {
	worker: WorkerAgent
}
