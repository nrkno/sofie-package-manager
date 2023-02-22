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
export class EvaluationScheduler {
	private scheduleTimeout: NodeJS.Timeout | undefined = undefined
	private runNextAsap = false

	private terminated = false
	private logger: LoggerInstance
	private runner: EvaluationRunner | null = null

	constructor(logger: LoggerInstance, private manager: InternalManager, private tracker: ExpectationTracker) {
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
	public triggerEvaluation(asap?: boolean): void {
		if (this.terminated) return

		if (asap) {
			this.runNextAsap = true
		}
		if (this.runner) {
			// Is already running
			if (asap) this.runner?.pleaseAbortRun()
			return
		}

		if (this.scheduleTimeout) {
			clearTimeout(this.scheduleTimeout)
			this.scheduleTimeout = undefined
		}

		this.scheduleTimeout = setTimeout(
			() => {
				if (this.terminated) return

				this.runNextAsap = false

				const runner = new EvaluationRunner(this.logger, this.manager, this.tracker)
				runner
					.run()
					.then((evaluationResult) => {
						this.runner = null
						this.triggerEvaluation(evaluationResult.runAgainASAP)
					})
					.catch((err) => {
						this.runner = null
						this.logger.error(`Error in EvaluationRunner.run(): ${stringifyError(err)}`)
						this.triggerEvaluation()
					})
			},
			this.runNextAsap ? 1 : this.tracker.constants.EVALUATE_INTERVAL
		)
	}
}
