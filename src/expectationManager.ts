import * as _ from 'underscore'
import { LoggerInstance } from './index'
import { Workforce } from './workforce'
import { Expectation } from './worker/expectationApi'
import { IWorkInProgress } from './worker/worker'

export class ExpectationManager {
	private HANDLE_INTERVAL = 2000

	private _workforce: Workforce = new Workforce()

	private receivedExpectations: { [id: string]: Expectation.Any } = {}
	private receivedExpectationsUpdated = false

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
		this.receivedExpectations = expectations
		this.receivedExpectationsUpdated = true

		this._triggerHandleExpectations()
	}
	private _triggerHandleExpectations(asap?: boolean) {
		if (this._handleExpectationsBusy) return

		if (this._handleExpectationsTimeout) {
			clearTimeout(this._handleExpectationsTimeout)
			this._handleExpectationsTimeout = undefined
		}

		this._handleExpectationsTimeout = setTimeout(
			() => {
				this._handleExpectationsBusy = true
				this._handleExpectations()
					.then((runAgainASAP: boolean) => {
						this._handleExpectationsBusy = false
						this._triggerHandleExpectations(runAgainASAP)
					})
					.catch((err) => {
						this.logger.error(err)

						this._handleExpectationsBusy = false
						this._triggerHandleExpectations()
					})
			},
			asap ? 100 : this.HANDLE_INTERVAL
		)
	}
	private async _handleExpectations(): Promise<boolean> {
		if (this.receivedExpectationsUpdated) {
			this.updateReceivedExpectations()
		}
		let runAgainASAP = false

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

		const goThroughTracked: TrackedExpectation[] = []
		for (let i = 0; i < tracked.length && i < MAX_COUNT_PER_ITERATION; i++) {
			goThroughTracked.push(tracked[i])
		}

		await Promise.all(
			goThroughTracked.map(async (trackedExp) => {
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
					} else {
						trackedExp.reason = 'No workers found'
						this.logger.info(`${trackedExp.exp.label}: Reason: ${trackedExp.reason}`)
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
							this.logger.info(
								`Expectation "${JSON.stringify(trackedExp.exp.label)}" progress: ${progress}`
							)
						})
						trackedExp.workInProgress.on('error', (err) => {
							trackedExp.reason = err
							this.logger.info(`${trackedExp.exp.label}: Reason: ${trackedExp.reason}`)
							trackedExp.lastOperationTime = Date.now()
							trackedExp.status = TrackedExpectationStatus.NOT_READY
						})
						trackedExp.workInProgress.on('done', (result: any) => {
							trackedExp.status = TrackedExpectationStatus.FULFILLED
							trackedExp.lastOperationTime = Date.now()
							if (trackedExp.handleResult) {
								trackedExp.handleResult(result)
							}
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
								trackedExp.lastOperationTime = 0 // so that it reruns ASAP
								runAgainASAP = true
							}
						}
					}
				}
				this.logger.info(`${trackedExp.exp.label}.status: ${trackedExp.status}`)
			})
		)

		return runAgainASAP
	}
	private updateReceivedExpectations(): void {
		this.receivedExpectationsUpdated = false

		// Added / Changed
		for (const id of Object.keys(this.receivedExpectations)) {
			const exp = this.receivedExpectations[id]

			let doUpdate = false
			if (!this.tracked[id]) {
				// new
				doUpdate = true
			} else if (!_.isEqual(this.tracked[id].exp, exp)) {
				const trackedExp = this.tracked[id]

				if (trackedExp.status !== TrackedExpectationStatus.WORKING) {
					doUpdate = true
				}
			}
			if (doUpdate) {
				this.tracked[id] = {
					exp: exp,
					status: TrackedExpectationStatus.NEW,
					potentialWorkerIds: [],
					lastOperationTime: 0,
				}
			}
		}

		// Removed:
		for (const id of Object.keys(this.tracked)) {
			if (!this.receivedExpectations[id]) {
				// This expectation has been removed
				// TODO: handled removed expectations!

				const trackedExp = this.tracked[id]

				if (trackedExp.status == TrackedExpectationStatus.WORKING) {
					if (trackedExp.workInProgress) {
						trackedExp.workInProgress.cancel()
					}
				}
				delete this.tracked[id]
			}
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
	lastOperationTime: number
	reason?: string
	workInProgress?: IWorkInProgress
	handleResult?: (result: any) => void
}
