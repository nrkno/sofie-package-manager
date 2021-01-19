import { EventEmitter } from 'events'
import { MessageFromWorker } from '../workerAgent'
import { Expectation } from './expectationApi'
import { CorePackageInfoInterface } from './lib/corePackageInto'

/**
 * A Worker runs static stateless/lamda functions.
 */
export abstract class GenericWorker {
	public corePackageInfoInterface = new CorePackageInfoInterface(this)
	constructor(public sendMessageToManager: MessageFromWorker) {}
	/**
	 * A check if the worker supports fulfilling the Expectation at all
	 */
	abstract doYouSupportExpectation(exp: Expectation.Any): Promise<{ support: boolean; reason: string }>
	/**
	 * A check if it is possible to start working on the Expectation.
	 */
	abstract isExpectationReadyToStartWorkingOn(exp: Expectation.Any): Promise<{ ready: boolean; reason?: string }>
	/**
	 * A check if the Expectation is fullfilled.
	 * If this is true, the Expectation needs not to be started working on.
	 */
	abstract isExpectationFullfilled(exp: Expectation.Any): Promise<{ fulfilled: boolean; reason?: string }>
	/**
	 * Tells the Worker to start working on fullfilling the Expectation.
	 */
	abstract workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress>
	/**
	 * Tells the Worker that an Expectation has been removed
	 */
	abstract removeExpectation(exp: Expectation.Any): Promise<{ removed: boolean; reason?: string }>
}

export interface WorkInProgressEvents {
	/** Progress 0-100 */
	progress: (actualVersionHash: string | null, progress: number) => void
	done: (actualVersionHash: string, reason: string, result: any) => void
	error: (actualVersionHash: string, error: string) => void
}
export declare interface IWorkInProgress {
	on<U extends keyof WorkInProgressEvents>(event: U, listener: WorkInProgressEvents[U]): this

	emit<U extends keyof WorkInProgressEvents>(event: U, ...args: Parameters<WorkInProgressEvents[U]>): boolean

	/** Cancels the job */
	cancel: () => Promise<void>
}
export class WorkInProgress extends EventEmitter implements IWorkInProgress {
	private _reportProgressTimeout: NodeJS.Timeout | undefined
	private _progress = 0
	private _actualVersionHash: string | null = null

	constructor(private _onCancel: () => Promise<void>) {
		super()
	}
	cancel(): Promise<void> {
		return this._onCancel()
	}

	_reportProgress(actualVersionHash: string | null, progress: number): void {
		this._progress = progress
		this._actualVersionHash = actualVersionHash

		if (!this._reportProgressTimeout) {
			this._reportProgressTimeout = setTimeout(() => {
				this._reportProgressTimeout = undefined
				this.emit('progress', this._actualVersionHash, this._progress)
			}, 300) // Rate-limit
		}
	}
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	_reportComplete(actualVersionHash: string, reason: string, result: any): void {
		this.emit('done', actualVersionHash, reason, result)
	}
	_reportError(err: Error): void {
		this.emit('error', err.toString() + err.stack)
	}
}
