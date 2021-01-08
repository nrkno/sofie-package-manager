import { WorkerAgent } from './workerAgent'

export class Workforce {
	private i = 0
	private workerAgents: { [id: string]: WorkerAgent } = {}

	async init(): Promise<void> {
		// todo: handle spinning up of worker agents intelligently
		// tmp:
		await this.addWorkerAgent()
		await this.addWorkerAgent()
		await this.addWorkerAgent()
	}
	getWorkerAgent(id: string): WorkerAgent | undefined {
		return this.workerAgents[id]
	}
	getWorkerAgentIds(): string[] {
		return Object.keys(this.workerAgents)
	}
	getWorkerAgents(): WorkerAgent[] {
		return Object.values(this.workerAgents)
	}
	getNextFreeWorker(ids: string[]): WorkerAgent | undefined {
		for (const id of ids) {
			const workerAgent = this.getWorkerAgent(id)
			if (workerAgent && workerAgent.isFree()) {
				return workerAgent
			}
		}
		return undefined
	}
	private async addWorkerAgent(): Promise<string> {
		const id = 'agent' + this.i++

		this.workerAgents[id] = new WorkerAgent(id)

		return id
	}
}
