import * as _ from 'underscore'
import { LoggerInstance } from './index'
import { Workforce } from './workforce'
import { Expectation } from './worker/expectationApi'
import { IWorkInProgress } from './worker/worker'
import { WorkerAgent } from './workerAgent'

export class ExpectationManager {
	private readonly HANDLE_INTERVAL = 2000

	private _workforce: Workforce = new Workforce()

	private receivedExpectations: { [id: string]: Expectation.Any } = {}
	private receivedExpectationsUpdated = false

	private tracked: { [id: string]: TrackedExpectation } = {}
	private triggerByFullfilledIds: { [fullfilledId: string]: string[] } = {}
	private _handleExpectationsTimeout: NodeJS.Timeout | undefined = undefined
	private _handleExpectationsBusy = false
	private _handleExpectationsRunAsap = false

	constructor(
		private logger: LoggerInstance,
		private updateExpectationStatus: (
			expectationId: string,
			expectaction: Expectation.Any | null,
			statusInfo: {
				status?: string
				progress?: number
				statusReason?: string
			}
		) => void
	) {
		this._triggerHandleExpectations(true)
	}

	async init(): Promise<void> {
		await this._workforce.init()
	}

	updateExpectations(expectations: { [id: string]: Expectation.Any }): void {
		this.receivedExpectations = expectations
		this.receivedExpectationsUpdated = true

		this._triggerHandleExpectations(true)
	}
	private _triggerHandleExpectations(asap?: boolean) {
		if (asap) this._handleExpectationsRunAsap = true
		if (this._handleExpectationsBusy) return

		if (this._handleExpectationsTimeout) {
			clearTimeout(this._handleExpectationsTimeout)
			this._handleExpectationsTimeout = undefined
		}

		this._handleExpectationsTimeout = setTimeout(
			() => {
				this._handleExpectationsRunAsap = false
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
			this._handleExpectationsRunAsap ? 100 : this.HANDLE_INTERVAL
		)
	}
	private async _handleExpectations(): Promise<boolean> {
		this.logger.info(Date.now() / 1000 + ' _handleExpectations ----------')
		if (this.receivedExpectationsUpdated) {
			await this.updateReceivedExpectations()
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

		const removeIds: string[] = []

		await Promise.all(
			goThroughTracked.map(async (trackedExp) => {
				const prevStatus = trackedExp.status
				const prevReason = trackedExp.reason

				if (trackedExp.status === TrackedExpectationStatus.NEW) {
					trackedExp.lastOperationTime = now

					// Check which workers might want to handle it:
					this.logger.info(`${trackedExp.exp.statusReport.label}: New`)

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
						this.logger.info(`${trackedExp.exp.statusReport.label}: Reason: ${trackedExp.reason}`)
					}
				}
				if (trackedExp.status === TrackedExpectationStatus.NOT_READY) {
					// Check if the expectation is ready to start:
					this.logger.info(`${trackedExp.exp.statusReport.label}: Not ready`)

					const workerAgent = this._workforce.getNextFreeWorker(trackedExp.potentialWorkerIds)
					if (workerAgent) {
						trackedExp.lastOperationTime = now
						// First, check if it is already fulfilled
						const fulfilled = await workerAgent.isExpectationFullfilled(trackedExp.exp)
						if (fulfilled.fulfilled) {
							// The expectation is already fulfilled
							trackedExp.status = TrackedExpectationStatus.FULFILLED
							trackedExp.reason = fulfilled.reason
							if (this.handleTriggerByFullfilledIds(trackedExp)) {
								runAgainASAP = true
							}
						} else {
							const readyToStart = await this.isExpectationReadyToStartWorkingOn(workerAgent, trackedExp)
							if (readyToStart.ready) {
								trackedExp.status = TrackedExpectationStatus.READY
							} else {
								trackedExp.reason = readyToStart.reason
								this.logger.info(`${trackedExp.exp.statusReport.label}: Reason: ${trackedExp.reason}`)
							}
						}
					}
				}
				if (trackedExp.status === TrackedExpectationStatus.READY) {
					// Start working on it:
					this.logger.info(`${trackedExp.exp.statusReport.label}: Ready`)

					const workerAgent = this._workforce.getNextFreeWorker(trackedExp.potentialWorkerIds)
					if (workerAgent) {
						trackedExp.lastOperationTime = now

						trackedExp.workInProgress = await workerAgent.workOnExpectation(trackedExp.exp)

						trackedExp.workInProgress.on('progress', (progress) => {
							this.logger.info(
								`Expectation "${JSON.stringify(
									trackedExp.exp.statusReport.label
								)}" progress: ${progress}`
							)

							this.updateExpectationStatus(trackedExp.id, trackedExp.exp, {
								progress: progress / 100,
							})
						})
						trackedExp.workInProgress.on('error', (err) => {
							if (trackedExp.status === TrackedExpectationStatus.WORKING) {
								trackedExp.reason = err
								this.logger.info(`${trackedExp.exp.statusReport.label}: Reason: ${trackedExp.reason}`)
								trackedExp.lastOperationTime = Date.now()
								trackedExp.status = TrackedExpectationStatus.NOT_READY

								this.updateExpectationStatus(trackedExp.id, trackedExp.exp, {
									status: trackedExp.status,
									statusReason: trackedExp.reason,
								})
							}
						})
						trackedExp.workInProgress.on('done', (reason: string, result: any) => {
							if (trackedExp.status === TrackedExpectationStatus.WORKING) {
								trackedExp.status = TrackedExpectationStatus.FULFILLED
								trackedExp.lastOperationTime = Date.now()
								trackedExp.reason = reason

								this.updateExpectationStatus(trackedExp.id, trackedExp.exp, {
									status: trackedExp.status,
									statusReason: trackedExp.reason,
									progress: 1,
								})

								if (trackedExp.handleResult) {
									trackedExp.handleResult(result)
								}
								if (this.handleTriggerByFullfilledIds(trackedExp)) {
									// Something was triggered, run again ASAP:
									this._triggerHandleExpectations(true)
								}
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
								this.logger.info(
									`${trackedExp.exp.statusReport.label}: Setting to Not ready, reason: ${trackedExp.reason}`
								)
								trackedExp.lastOperationTime = 0 // so that it reruns ASAP
								runAgainASAP = true
							}
						}
					}
				}
				if (trackedExp.status === TrackedExpectationStatus.REMOVED) {
					const workerAgent = this._workforce.getNextFreeWorker(trackedExp.potentialWorkerIds)
					if (workerAgent) {
						const removed = await workerAgent.removeExpectation(trackedExp.exp)
						if (removed.removed) {
							removeIds.push(trackedExp.id)

							this.updateExpectationStatus(trackedExp.id, null, {})
						} else {
							trackedExp.reason = removed.reason
						}
					}
				}
				if (trackedExp.status !== prevStatus) {
					this.updateExpectationStatus(trackedExp.id, trackedExp.exp, {
						status: trackedExp.status,
					})
				}
				if (trackedExp.reason !== prevReason) {
					this.updateExpectationStatus(trackedExp.id, trackedExp.exp, {
						statusReason: trackedExp.reason,
					})
				}
				this.logger.info(`${trackedExp.exp.statusReport.label}.status: ${trackedExp.status}`)
			})
		)
		for (const id of removeIds) {
			delete this.tracked[id]
		}
		return runAgainASAP
	}
	private async updateReceivedExpectations(): Promise<void> {
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

				if (trackedExp.status == TrackedExpectationStatus.WORKING) {
					if (trackedExp.workInProgress) {
						await trackedExp.workInProgress.cancel()
					}
				}
				doUpdate = true
			}
			if (doUpdate) {
				this.tracked[id] = {
					id: id,
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
						await trackedExp.workInProgress.cancel()
					}
				}

				trackedExp.status = TrackedExpectationStatus.REMOVED
				trackedExp.lastOperationTime = 0 // To rerun ASAP
			}
		}

		this.triggerByFullfilledIds = {}
		for (const id of Object.keys(this.tracked)) {
			const trackedExp = this.tracked[id]
			if (trackedExp.exp.triggerByFullfilledIds) {
				for (const triggerByFullfilledId of trackedExp.exp.triggerByFullfilledIds) {
					if (triggerByFullfilledId === id) {
						throw new Error(`triggerByFullfilledIds not allowed to contain it's own id: "${id}"`)
					}

					if (!this.triggerByFullfilledIds[triggerByFullfilledId]) {
						this.triggerByFullfilledIds[triggerByFullfilledId] = []
					}
					this.triggerByFullfilledIds[triggerByFullfilledId].push(trackedExp.id)
				}
			}
		}
	}
	/**
	 * To be called when trackedExp.status turns fullfilled.
	 * Triggers any other expectations that listens to the fullfilled one.
	 */
	private handleTriggerByFullfilledIds(trackedExp: TrackedExpectation): boolean {
		let hasTriggeredSomething = false
		if (trackedExp.status === TrackedExpectationStatus.FULFILLED) {
			const toTriggerIds = this.triggerByFullfilledIds[trackedExp.id] || []

			for (const id of toTriggerIds) {
				const toTriggerExp = this.tracked[id]
				if (toTriggerExp) {
					toTriggerExp.lastOperationTime = 0 // so that it reruns ASAP
					hasTriggeredSomething = true
				}
			}
		}
		return hasTriggeredSomething
	}
	private async isExpectationReadyToStartWorkingOn(
		workerAgent: WorkerAgent,
		trackedExp: TrackedExpectation
	): Promise<{
		ready: boolean
		reason?: string | undefined
	}> {
		if (trackedExp.exp.dependsOnFullfilled?.length) {
			// Check if those are fullfilled:
			let waitingFor: TrackedExpectation | undefined = undefined
			for (const id of trackedExp.exp.dependsOnFullfilled) {
				if (this.tracked[id].status !== TrackedExpectationStatus.FULFILLED) {
					waitingFor = this.tracked[id]
					break
				}
			}
			if (waitingFor) {
				return {
					ready: false,
					reason: `Waiting for "${waitingFor.exp.statusReport.label}"`,
				}
			}
		}

		return await workerAgent.isExpectationReadyToStartWorkingOn(trackedExp.exp)
	}
}
enum TrackedExpectationStatus {
	NEW = 'new',
	NOT_READY = 'not_ready',
	READY = 'ready',
	WORKING = 'working',
	FULFILLED = 'fulfilled',
	REMOVED = 'removed',
}
interface TrackedExpectation {
	id: string
	exp: Expectation.Any
	status: TrackedExpectationStatus
	potentialWorkerIds: string[]
	lastOperationTime: number
	reason?: string
	workInProgress?: IWorkInProgress
	handleResult?: (result: any) => void
}
