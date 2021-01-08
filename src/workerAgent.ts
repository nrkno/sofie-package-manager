import { Expectation } from './worker/expectationApi'
import { GenericWorker, IWorkInProgress } from './worker/worker'
import { NodeJSWorker } from './worker/workers/nodeJSWorker'

// Note:
// The long-term goal is that Worker-Agents are separate processes / containers
// In this initial implementation, we just run them as-is.

export class WorkerAgent {
	private _worker: GenericWorker
	private _busyMethodCount = 0

	constructor(public readonly id: string) {
		// Todo: Different types of workers
		this._worker = new NodeJSWorker()
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<boolean> {
		return this._worker.doYouSupportExpectation(exp)
	}
	async isExpectationReadyToStartWorkingOn(exp: Expectation.Any): Promise<{ ready: boolean; reason?: string }> {
		return this.setBusy(() => this._worker.isExpectationReadyToStartWorkingOn(exp))
	}
	async isExpectationFullfilled(exp: Expectation.Any): Promise<{ fulfilled: boolean; reason?: string }> {
		return this.setBusy(() => this._worker.isExpectationFullfilled(exp))
	}
	async workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress> {
		return this.setBusy(() => this._worker.workOnExpectation(exp))
	}
	private async setBusy<T>(fcn: () => Promise<T>): Promise<T> {
		this._busyMethodCount++
		try {
			const result = await fcn()
			this._busyMethodCount--
			return result
		} catch (err) {
			this._busyMethodCount--
			throw err
		}
	}
	isFree(): boolean {
		return this._busyMethodCount === 0
	}
}
