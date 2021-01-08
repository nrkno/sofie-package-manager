import * as _ from 'underscore'
import { LoggerInstance } from './index'
import { Workforce } from './workforce'
import { Expectation } from './worker/expectationApi'
import { IWorkInProgress } from './worker/worker'

export class ExpectationManager {
	private HANDLE_INTERVAL = 2000

	private _workforce: Workforce = new Workforce()

	private tracked: { [id: string]: TrackedExpectation } = {}
	private _handleExpectationsTimeout: NodeJS.Timeout | undefined = undefined
	private _handleExpectationsBusy = false

	constructor(private logger: LoggerInstance) {
		this._triggerHandleExpectations()
	}

	async init(): Promise<void> {
		await this._workforce.init()
	}

	updateExpectations(expectations: { [id: string]: Expectation.Any }): void {
		// Added / Changed
		for (const id of Object.keys(expectations)) {
			const exp = expectations[id]

			if (!this.tracked[id]) {
				// new
				this.tracked[id] = {
					exp: exp,
					status: TrackedExpectationStatus.NEW,
					potentialWorkerIds: [],
					lastOperationTime: 0,
				}
			} else if (!_.isEqual(this.tracked[id].exp, exp)) {
				// modified
				// TODO: Handle a changed expectation!
			}
		}

		// Removed:
		for (const id of Object.keys(this.tracked)) {
			if (!expectations[id]) {
				// This expectation has been removed
				// TODO: handled removed expectations!
				this.tracked[id].removed = true
			}
		}
		this._triggerHandleExpectations()
	}
	private _triggerHandleExpectations() {
		if (this._handleExpectationsBusy) return

		if (this._handleExpectationsTimeout) {
			clearTimeout(this._handleExpectationsTimeout)
			this._handleExpectationsTimeout = undefined
		}

		this._handleExpectationsTimeout = setTimeout(() => {
			this._handleExpectationsBusy = true
			this._handleExpectations()
				.then(() => {
					this._handleExpectationsBusy = false
					this._triggerHandleExpectations()
				})
				.catch((err) => {
					this.logger.error(err)

					this._handleExpectationsBusy = false
					this._triggerHandleExpectations()
				})
		}, this.HANDLE_INTERVAL)
	}
	private async _handleExpectations() {
		const now = Date.now()

		const MAX_COUNT_PER_ITERATION = 10
		const RETRY_TIME = 10 * 1000 // ms
		const FULLFILLED_MONITOR_TIME = 10 * 1000 // ms

		const tracked: TrackedExpectation[] = []
		for (const id of Object.keys(this.tracked)) {
			const trackedExp = this.tracked[id]

			if (now - trackedExp.lastOperationTime > RETRY_TIME) {
				tracked.push(trackedExp)
			}
		}
		tracked.sort((a, b) => a.lastOperationTime - b.lastOperationTime)

		for (let i = 0; i < tracked.length && i < MAX_COUNT_PER_ITERATION; i++) {
			const trackedExp = tracked[i]

			if (trackedExp.status === TrackedExpectationStatus.NEW) {
				trackedExp.lastOperationTime = now

				// Check which workers might want to handle it:
				this.logger.info(`${trackedExp.exp.label}: New`)

				trackedExp.potentialWorkerIds = []
				for (const workerAgent of this._workforce.getWorkerAgents()) {
					if (workerAgent && (await workerAgent.doYouSupportExpectation(trackedExp.exp))) {
						trackedExp.potentialWorkerIds.push(workerAgent.id)
					}
				}
				if (trackedExp.potentialWorkerIds.length) {
					trackedExp.status = TrackedExpectationStatus.NOT_READY
				}
			}
			if (trackedExp.status === TrackedExpectationStatus.NOT_READY) {
				// Check if the expectation is ready to start:
				this.logger.info(`${trackedExp.exp.label}: Not ready`)

				const workerAgent = this._workforce.getNextFreeWorker(trackedExp.potentialWorkerIds)
				if (workerAgent) {
					trackedExp.lastOperationTime = now
					// First, check if it is already fulfilled
					const fulfilled = await workerAgent.isExpectationFullfilled(trackedExp.exp)
					if (fulfilled.fulfilled) {
						// The expectation is already fulfilled
						trackedExp.status = TrackedExpectationStatus.FULFILLED
					} else {
						const readyToStart = await workerAgent.isExpectationReadyToStartWorkingOn(trackedExp.exp)
						if (readyToStart.ready) {
							trackedExp.status = TrackedExpectationStatus.READY
						} else {
							trackedExp.reason = readyToStart.reason
							this.logger.info(`${trackedExp.exp.label}: Reason: ${trackedExp.reason}`)
						}
					}
				}
			}
			if (trackedExp.status === TrackedExpectationStatus.READY) {
				// Start working on it:
				this.logger.info(`${trackedExp.exp.label}: Ready`)

				const workerAgent = this._workforce.getNextFreeWorker(trackedExp.potentialWorkerIds)
				if (workerAgent) {
					trackedExp.lastOperationTime = now

					trackedExp.workInProgress = await workerAgent.workOnExpectation(trackedExp.exp)

					trackedExp.workInProgress.on('progress', (progress) => {
						this.logger.info(`Expectation "${JSON.stringify(trackedExp.exp.label)}" progress: ${progress}`)
					})
					trackedExp.workInProgress.on('error', (err) => {
						trackedExp.reason = err
						this.logger.info(`${trackedExp.exp.label}: Reason: ${trackedExp.reason}`)
						trackedExp.lastOperationTime = Date.now()
						trackedExp.status = TrackedExpectationStatus.NOT_READY
					})
					trackedExp.workInProgress.on('done', () => {
						trackedExp.status = TrackedExpectationStatus.FULFILLED
						trackedExp.lastOperationTime = Date.now()
					})

					trackedExp.status = TrackedExpectationStatus.WORKING
				}
			}
			if (trackedExp.status === TrackedExpectationStatus.FULFILLED) {
				// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore

				if (now - trackedExp.lastOperationTime > FULLFILLED_MONITOR_TIME) {
					trackedExp.lastOperationTime = now

					const workerAgent = this._workforce.getNextFreeWorker(trackedExp.potentialWorkerIds)
					if (workerAgent) {
						// Check if it is still fulfilled:
						const fulfilled = await workerAgent.isExpectationFullfilled(trackedExp.exp)
						if (!fulfilled.fulfilled) {
							trackedExp.status = TrackedExpectationStatus.NOT_READY
							trackedExp.reason = fulfilled.reason
						}
					}
				}
			}
			this.logger.info(`${trackedExp.exp.label}: ${trackedExp.status}`)
		}
	}
}
enum TrackedExpectationStatus {
	NEW = 'new',
	NOT_READY = 'not_ready',
	READY = 'ready',
	WORKING = 'working',
	FULFILLED = 'fulfilled',
}
interface TrackedExpectation {
	exp: Expectation.Any
	status: TrackedExpectationStatus
	potentialWorkerIds: string[]
	removed?: boolean
	lastOperationTime: number
	reason?: string
	workInProgress?: IWorkInProgress
}
