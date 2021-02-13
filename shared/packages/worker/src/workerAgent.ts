import {
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@shared/api'
import { IWorkInProgress } from './worker/lib/workInProgress'
import { GenericWorker } from './worker/worker'
import { WindowsWorker } from './worker/workers/windowsWorker/windowsWorker'

// Note:
// The long-term goal is that Worker-Agents are separate processes / containers
// In this initial implementation, we just run them as-is.

export class WorkerAgent {
	private _worker: GenericWorker
	private _busyMethodCount = 0

	private currentJobs: { cost: ExpectationCost; progress: number }[] = []

	constructor(public readonly id: string, private onMessageFromWorker: MessageFromWorkerSerialized) {
		// Todo: Different types of workers
		this._worker = new WindowsWorker(
			{
				allowedMappedDriveLetters: ['X', 'Y', 'Z'],
			},
			async (message: MessageFromWorkerPayload) => {
				// Forward the message to our superior over the wire:
				const { error, result } = await this.onMessageFromWorker(message)
				if (error) {
					throw new Error(error)
				} else {
					return result
				}
			},
			{
				// todo: tmp:
				localComputerId: 'default',
				localNetworkIds: ['default'],
			}
		)
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return await this._worker.doYouSupportExpectation(exp)
	}
	async getCostForExpectation(exp: Expectation.Any): Promise<ExpectationCost> {
		const cost = await this._worker.getCostFortExpectation(exp)

		return {
			cost: cost,
			startCost: this.currentJobs.reduce((sum, job) => sum + job.cost.cost * (1 - job.progress), 0),
		}
	}
	async isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		return this._worker.isExpectationReadyToStartWorkingOn(exp)
	}
	async isExpectationFullfilled(
		exp: Expectation.Any,
		wasFullfilled: boolean
	): Promise<ReturnTypeIsExpectationFullfilled> {
		return this._worker.isExpectationFullfilled(exp, wasFullfilled)
	}
	async workOnExpectation(exp: Expectation.Any, cost: ExpectationCost): Promise<IWorkInProgress> {
		const currentjob = {
			cost: cost,
			progress: 0,
			// callbacksOnDone: [],
		}
		this.currentJobs.push(currentjob)

		const workInProgress = await this._worker.workOnExpectation(exp)

		workInProgress.on('progress', (_, progress: number) => {
			currentjob.progress = progress
		})
		workInProgress.on('error', () => {
			this.currentJobs = this.currentJobs.filter((job) => job !== currentjob)
		})
		workInProgress.on('done', () => {
			this.currentJobs = this.currentJobs.filter((job) => job !== currentjob)
		})

		return workInProgress
	}
	async removeExpectation(exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> {
		return this._worker.removeExpectation(exp)
	}
	/** Keep track of the promise retorned by fcn and when it's resolved, to determine how busy we are */
	// private async setBusy<T>(fcn: () => Promise<T>): Promise<T> {
	// 	this._busyMethodCount++
	// 	try {
	// 		const result = await fcn()
	// 		this._busyMethodCount--
	// 		return result
	// 	} catch (err) {
	// 		this._busyMethodCount--
	// 		throw err
	// 	}
	// }
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
export interface ExpectationCost {
	/** Cost for working on the Expectation */
	cost: number
	/** Cost "in queue" until working on the Expectation can start */
	startCost: number
}
