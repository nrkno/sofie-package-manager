import {
	ExpectationManagerWorkerAgent,
	Reason,
	stringifyError,
	INNER_ACTION_TIMEOUT,
	promiseTimeout,
	HelpfulEventEmitter,
} from '@sofie-package-manager/api'

export interface WorkInProgressEvents {
	/** Progress 0-100 */
	progress: (actualVersionHash: string | null, progress: number) => void
	done: (actualVersionHash: string, reason: Reason, result: any) => void
	error: (reason: string) => void
}
export declare interface IWorkInProgress {
	properties: ExpectationManagerWorkerAgent.WorkInProgressProperties

	on<U extends keyof WorkInProgressEvents>(event: U, listener: WorkInProgressEvents[U]): this

	emit<U extends keyof WorkInProgressEvents>(event: U, ...args: Parameters<WorkInProgressEvents[U]>): boolean

	/** Cancels the job */
	cancel: () => Promise<void>
}
export class WorkInProgress extends HelpfulEventEmitter implements IWorkInProgress {
	private _reportProgressTimeout: NodeJS.Timeout | undefined
	private _progress = 0
	private _actualVersionHash: string | null = null

	constructor(
		public properties: ExpectationManagerWorkerAgent.WorkInProgressProperties,
		private _onCancel: () => Promise<void>
	) {
		super()
	}
	async cancel(): Promise<void> {
		// Safe guard against timeouts:

		await promiseTimeout(
			this._onCancel(),
			INNER_ACTION_TIMEOUT,
			`WorkInProgress.cancel() timeout "${this.properties.workLabel}"`
		)
	}

	/**
	 * Report progress back to
	 * @param actualVersionHash A hash of the actual Version of the Package being worked on
	 * @param progress 0-1
	 */
	_reportProgress(actualVersionHash: string | null, progress: number): void {
		this._progress = progress
		this._actualVersionHash = actualVersionHash

		if (!this._reportProgressTimeout) {
			this._reportProgressTimeout = setTimeout(() => {
				this._reportProgressTimeout = undefined
				this.emit('progress', this._actualVersionHash, this._progress)
			}, 500) // Rate-limit
		}
	}
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	_reportComplete(actualVersionHash: string, reason: Reason, result: any): void {
		this.emit('done', actualVersionHash, reason, result)
	}
	_reportError(err: unknown): void {
		this.emit('error', stringifyError(err))
	}
	/** Convenience function which calls the function that performs the work */
	do(fcn: () => Promise<void> | void): WorkInProgress {
		setTimeout(() => {
			try {
				Promise.resolve(fcn()).catch((err) => {
					this._reportError(err)
				})
			} catch (err) {
				this._reportError(err)
			}
		}, 1)
		return this
	}
}
