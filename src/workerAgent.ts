import { Expectation } from './worker/expectationApi'
import { IWorkInProgress } from './worker/lib/workInProgress'
import { GenericWorker } from './worker/worker'
import { WindowsWorker } from './worker/workers/windowsWorker/windowsWorker'

// Note:
// The long-term goal is that Worker-Agents are separate processes / containers
// In this initial implementation, we just run them as-is.

export class WorkerAgent {
	private _worker: GenericWorker
	private _busyMethodCount = 0

	constructor(public readonly id: string, private onMessageFromWorker: MessageFromWorkerSerialized) {
		// Todo: Different types of workers
		this._worker = new WindowsWorker(
			async (message: MessageFromWorkerPayload) => {
				// Forward the message to our superior over the wire:
				const { error, result } = await this.onMessageFromWorker(message)
				if (error) {
					throw new Error(error)
				} else {
					return result
				}
			},
			'default',
			['default']
		)
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<{ support: boolean; reason: string }> {
		return await this._worker.doYouSupportExpectation(exp)
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
	async removeExpectation(exp: Expectation.Any): Promise<{ removed: boolean; reason?: string }> {
		return this.setBusy(() => this._worker.removeExpectation(exp))
	}
	/** Keep track of the promise retorned by fcn and when it's resolved, to determine how busy we are */
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

export type MessageFromWorker = (message: MessageFromWorkerPayload) => Promise<any>
export type MessageFromWorkerSerialized = (message: MessageFromWorkerPayload) => Promise<ReplyToWorker>
export interface MessageFromWorkerPayload {
	type: string
	arguments: any[]
}

export interface ReplyToWorker {
	error?: string
	result?: any
}
