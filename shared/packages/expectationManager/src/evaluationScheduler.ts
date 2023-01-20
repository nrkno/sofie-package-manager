import { LoggerInstance, stringifyError } from '@sofie-package-manager/api'
import { EvaluationRunner } from './evaluationRunner'
import { ExpectationManagerInternal } from './expectationManagerInternal'
import { ExpectationTracker } from './expectationTracker'

/**
 * The EvaluateRunner goes through one pass of evaluation of expectations.
 * When an evaulation is scheduled to run,
 * a new instance of EvaluateRunner is created, then the async .run() method is called.
 * After .run() is done, the instance is teared down.
 */
export class EvaluationScheduler {
	private scheduleTimeout: NodeJS.Timeout | undefined = undefined
	private isRunning = false
	private _runNextAsap = false

	private terminated = false
	private logger: LoggerInstance

	constructor(
		logger: LoggerInstance,
		private manager: ExpectationManagerInternal,
		private tracker: ExpectationTracker
	) {
		this.logger = logger.category('Scheduler')
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
	public triggerEvaluateExpectations(asap?: boolean): void {
		if (this.terminated) return

		if (asap) this._runNextAsap = true
		if (this.isRunning) return

		if (this.scheduleTimeout) {
			clearTimeout(this.scheduleTimeout)
			this.scheduleTimeout = undefined
		}

		this.scheduleTimeout = setTimeout(
			() => {
				if (this.terminated) return

				this._runNextAsap = false
				this.isRunning = true

				const runner = new EvaluationRunner(this.logger, this.manager, this.tracker)
				runner
					.run()
					.then((evaluationResult) => {
						this.isRunning = false

						this.triggerEvaluateExpectations(evaluationResult.runAgainASAP)
					})
					.catch((err) => {
						this.logger.error(`Error in EvaluationRunner.run(): ${stringifyError(err)}`)

						this.isRunning = false
						this.triggerEvaluateExpectations()
					})
			},
			this._runNextAsap ? 1 : this.tracker.constants.EVALUATE_INTERVAL
		)
	}
}
