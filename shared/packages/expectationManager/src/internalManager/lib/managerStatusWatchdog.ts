import { LoggerInstance, StatusCode } from '@sofie-package-manager/api'
import { ExpectationTracker } from '../../expectationTracker/expectationTracker'
import { ManagerStatusReporter } from './managerStatusReporter'

/** Monitors the status of the ExpectationTracker and alerts if there's a problem */
export class ManagerStatusWatchdog {
	private checkStatusInterval: NodeJS.Timeout | null = null

	/** Timestamp, used to determine how long the work-queue has been stuck */
	private stuckTimestamp: number | null = null

	private logger: LoggerInstance
	constructor(
		logger: LoggerInstance,
		private tracker: ExpectationTracker,
		private managerStatuses: ManagerStatusReporter
	) {
		this.logger = logger.category('StatusMonitor')

		this.checkStatusInterval = setInterval(() => {
			this._checkStatus()
		}, 60 * 1000)
	}

	public terminate(): void {
		if (this.checkStatusInterval) {
			clearInterval(this.checkStatusInterval)
			this.checkStatusInterval = null
		}
	}

	private _checkStatus() {
		// If the work-queue is long (>10 items) and nothing has progressed for the past 10 minutes.

		const waitingExpectationCount = this.tracker.scaler.getWaitingExpectationCount()

		if (waitingExpectationCount > 10) {
			if (!this.stuckTimestamp) {
				this.stuckTimestamp = Date.now()
			}
		} else {
			this.stuckTimestamp = null
		}

		const stuckDuration: number = this.stuckTimestamp ? Date.now() - this.stuckTimestamp : 0
		if (stuckDuration > 10 * 60 * 1000) {
			this.logger.error(`_monitorStatus: Work Queue is Stuck for ${stuckDuration / 1000 / 60} minutes`)
			this.managerStatuses.update('work-queue-stuck', {
				statusCode: StatusCode.BAD,
				message: `The Work-queue has been stuck for ${Math.round(
					stuckDuration / 1000 / 60
				)} minutes, and there are ${waitingExpectationCount} waiting`,
			})
		} else {
			this.managerStatuses.update('work-queue-stuck', { statusCode: StatusCode.GOOD, message: '' })
		}
	}
}
