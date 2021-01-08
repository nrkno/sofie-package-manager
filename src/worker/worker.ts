import { EventEmitter } from 'events'
import { Expectation } from './expectationApi'

/**
 * A Worker runs static stateless/lamda functions.
 */
export abstract class GenericWorker {
	/**
	 * A check if the worker supports fulfilling the Expectation at all
	 */
	abstract doYouSupportExpectation(exp: Expectation.Any): boolean
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
}

export interface WorkInProgressEvents {
	/** Progress 0-100 */
	progress: (progress: number) => void
	done: () => void
	error: (error: string) => void
}
export declare interface IWorkInProgress {
	on<U extends keyof WorkInProgressEvents>(event: U, listener: WorkInProgressEvents[U]): this

	emit<U extends keyof WorkInProgressEvents>(event: U, ...args: Parameters<WorkInProgressEvents[U]>): boolean

	/** Cancels the job */
	cancel: () => Promise<void>
}
export class WorkInProgress extends EventEmitter implements IWorkInProgress {
	constructor(private _onCancel: () => Promise<void>) {
		super()
	}
	cancel(): Promise<void> {
		return this._onCancel()
	}

	_reportProgress(progress: number): void {
		this.emit('progress', progress)
	}
	_reportComplete(): void {
		this.emit('done')
	}
	_reportError(err: string): void {
		this.emit('error', err)
	}
}
