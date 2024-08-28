import { EventEmitter } from 'events'
import { LoggerInstance, stringifyError } from '@sofie-package-manager/api'
import { EvaluationRunner } from '../../evaluationRunner/evaluationRunner'
import { InternalManager } from '../../internalManager/internalManager'
import { ExpectationTracker } from '../expectationTracker'

/**
 * The EvaluateRunner goes through one pass of evaluation of expectations.
 * When an evaulation is scheduled to run,
 * a new instance of EvaluateRunner is created, then the async .run() method is called.
 * After .run() is done, the instance is teared down.
 */
export class EvaluationScheduler extends EventEmitter {
	private scheduleTimeout: NodeJS.Timeout | undefined = undefined
	private currentRunner: EvaluationRunner | null = null
	private _runNextAsap = false

	private terminated = false
	private logger: LoggerInstance

	constructor(logger: LoggerInstance, private manager: InternalManager, private tracker: ExpectationTracker) {
		super()
		this.logger = logger.category('Scheduler')
	}
	public isRunning(): boolean {
		return Boolean(this.currentRunner)
	}

	public terminate(): void {
		this.terminated = true

		if (this.scheduleTimeout) {
			clearTimeout(this.scheduleTimeout)
			this.scheduleTimeout = undefined
		}
	}
	/**
	 * Schedule an evaluation to run
	 * @param asap if true, will run an evaluation as soon as possible
	 */
	public triggerEvaluation(asap?: boolean): void {
		if (this.terminated) return

		if (asap) this._runNextAsap = true
		if (this.currentRunner) return

		if (this.scheduleTimeout) {
			clearTimeout(this.scheduleTimeout)
			this.scheduleTimeout = undefined
		}

		this.scheduleTimeout = setTimeout(
			() => {
				if (this.terminated) return

				this._runNextAsap = false

				this.currentRunner = new EvaluationRunner(this.logger, this.manager, this.tracker)
				this.currentRunner
					.run()
					.then((evaluationResult) => {
						this.currentRunner = null
						this.emit('idle')

						this.triggerEvaluation(evaluationResult?.runAgainASAP)
					})
					.catch((err) => {
						this.logger.error(`Error in EvaluationRunner.run(): ${stringifyError(err)}`)

						this.currentRunner = null
						this.emit('idle')
						this.triggerEvaluation()
					})
			},
			this._runNextAsap ? 1 : this.tracker.constants.EVALUATE_INTERVAL
		)
	}
	public abortAndTriggerEvaluation(): void {
		this.currentRunner?.abort()
		this.triggerEvaluation(true)
	}
}
