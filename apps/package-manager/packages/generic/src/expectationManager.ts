import * as _ from 'underscore'
import { LoggerInstance } from './index'
import { Expectation } from '@shared/api'
import { Workforce, IWorkInProgress, ExpectationCost, MessageFromWorker, WorkerAgent } from '@shared/worker'

import { PackageContainerPackageStatus, PackageContainerPackageStatusStatus } from './packageManager'

export class ExpectationManager {
	private readonly EVALUATE_INTERVAL = 10 * 1000
	private readonly FULLFILLED_MONITOR_TIME = 10 * 1000 // ms
	private readonly ALLOW_SKIPPING_QUEUE_TIME = 30 * 1000 // ms

	private _workforce: Workforce = new Workforce(this.onMessageFromWorker)

	private receivedExpectations: { [id: string]: Expectation.Any } = {}
	private receivedExpectationsHasBeenUpdated = false

	private tracked: { [id: string]: TrackedExpectation } = {}
	private triggerByFullfilledIds: { [fullfilledId: string]: string[] } = {}
	private _evaluateExpectationsTimeout: NodeJS.Timeout | undefined = undefined
	private _evaluateExpectationsIsBusy = false
	private _evaluateExpectationsRunAsap = false

	constructor(
		private logger: LoggerInstance,
		private reportExpectationStatus: (
			expectationId: string,
			expectaction: Expectation.Any | null,
			actualVersionHash: string | null,
			statusInfo: {
				status?: string
				progress?: number
				statusReason?: string
			}
		) => void,
		private reportPackageContainerPackageStatus: (
			containerId: string,
			packageId: string,
			packageStatus: PackageContainerPackageStatus | null
		) => void,
		private onMessageFromWorker: MessageFromWorker
	) {
		this._triggerEvaluateExpectations(true)
	}

	async init(): Promise<void> {
		await this._workforce.init()
	}

	updateExpectations(expectations: { [id: string]: Expectation.Any }): void {
		this.receivedExpectations = expectations
		this.receivedExpectationsHasBeenUpdated = true

		this._triggerEvaluateExpectations(true)
	}
	private _triggerEvaluateExpectations(asap?: boolean) {
		if (asap) this._evaluateExpectationsRunAsap = true
		if (this._evaluateExpectationsIsBusy) return

		if (this._evaluateExpectationsTimeout) {
			clearTimeout(this._evaluateExpectationsTimeout)
			this._evaluateExpectationsTimeout = undefined
		}

		this._evaluateExpectationsTimeout = setTimeout(
			() => {
				this._evaluateExpectationsRunAsap = false
				this._evaluateExpectationsIsBusy = true
				this._evaluateExpectations()
					.then(() => {
						this._evaluateExpectationsIsBusy = false
						this._triggerEvaluateExpectations()
					})
					.catch((err) => {
						this.logger.error(err)

						this._evaluateExpectationsIsBusy = false
						this._triggerEvaluateExpectations()
					})
			},
			this._evaluateExpectationsRunAsap ? 100 : this.EVALUATE_INTERVAL
		)
	}
	private async _evaluateExpectations(): Promise<void> {
		this.logger.info(Date.now() / 1000 + ' _evaluateExpectations ----------')
		if (this.receivedExpectationsHasBeenUpdated) {
			await this.updateReceivedExpectations()
		}

		const tracked: TrackedExpectation[] = Object.values(this.tracked)
		tracked.sort((a, b) => {
			// Lowest priority first
			if (a.exp.priority > b.exp.priority) return 1
			if (a.exp.priority < b.exp.priority) return -1

			// Lowest lastOperationTime first
			if (a.lastEvaluationTime > b.lastEvaluationTime) return 1
			if (a.lastEvaluationTime < b.lastEvaluationTime) return -1

			return 0
		})

		const startTime = Date.now()
		let runAgainASAP = false
		const removeIds: string[] = []

		for (const trackedExp of tracked) {
			let assignedWorker: WorkerAgentAssignment | undefined
			let runAgain = true
			let runCount = 0
			while (runAgain) {
				runAgain = false
				runCount++
				const session = await this.evaluateTrackedExpectation(trackedExp, assignedWorker)
				assignedWorker = session.assignedWorker // So that this will be piped right into the evatuation on next pass
				if (session.triggerExpectationAgain && runCount < 10) {
					// Will cause this expectation to be evaluated again ASAP
					runAgain = true
				}
				if (session.triggerOtherExpectationsAgain) {
					// Will cause another iteration of this._handleExpectations to be called again ASAP after this iteration has finished
					runAgainASAP = true
				}
				if (session.expectationCanBeRemoved) {
					// The tracked expectation can be removed
					removeIds.push(trackedExp.id)
				}
			}
			if (runAgainASAP && Date.now() - startTime > this.ALLOW_SKIPPING_QUEUE_TIME) {
				// Skip the rest of the queue, so that we don't get stuck on evaluating low-prios far down the line.
				break
			}
			if (this.receivedExpectationsHasBeenUpdated) {
				// We have received new expectations. We should abort the evaluation queue and restart from the beginning.
				runAgainASAP = true
				break
			}
		}
		for (const id of removeIds) {
			delete this.tracked[id]
		}
		if (runAgainASAP) {
			this._triggerEvaluateExpectations(true)
		}
	}
	private async updateReceivedExpectations(): Promise<void> {
		this.receivedExpectationsHasBeenUpdated = false

		// Added / Changed
		for (const id of Object.keys(this.receivedExpectations)) {
			const exp = this.receivedExpectations[id]

			let doUpdate = false
			if (!this.tracked[id]) {
				// new
				doUpdate = true
			} else if (!_.isEqual(this.tracked[id].exp, exp)) {
				const trackedExp = this.tracked[id]

				if (trackedExp.state == TrackedExpectationState.WORKING) {
					if (trackedExp.workInProgress) {
						this.logger.info(`Cancelling ${trackedExp.id} due to update`)
						await trackedExp.workInProgress.cancel()
					}
				}
				doUpdate = true
			}
			if (doUpdate) {
				this.tracked[id] = {
					id: id,
					exp: exp,
					state: TrackedExpectationState.NEW,
					availableWorkers: [],
					lastEvaluationTime: 0,
					reason: 'N/A',
				}
			}
		}

		// Removed:
		for (const id of Object.keys(this.tracked)) {
			if (!this.receivedExpectations[id]) {
				// This expectation has been removed
				// TODO: handled removed expectations!

				const trackedExp = this.tracked[id]

				if (trackedExp.state == TrackedExpectationState.WORKING) {
					if (trackedExp.workInProgress) {
						this.logger.info(`Cancelling ${trackedExp.id} due to removed`)
						await trackedExp.workInProgress.cancel()
					}
				}

				trackedExp.state = TrackedExpectationState.REMOVED
				trackedExp.lastEvaluationTime = 0 // To rerun ASAP
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
	async evaluateTrackedExpectation(
		trackedExp: TrackedExpectation,
		assignedWorker0: WorkerAgentAssignment | undefined
	): Promise<ExpectationStateHandlerSession> {
		const timeSinceLastEvaluation = Date.now() - trackedExp.lastEvaluationTime

		const session: ExpectationStateHandlerSession = {
			triggerExpectationAgain: false,
			triggerOtherExpectationsAgain: false,
			assignedWorker: assignedWorker0,
		}
		try {
			if (trackedExp.state === TrackedExpectationState.NEW) {
				// Check which workers might want to handle it:

				trackedExp.availableWorkers = []
				let notSupportReason = 'No workers registered'
				await Promise.all(
					this._workforce.getAllWorkerAgents().map(async (workerAgent) => {
						const support = await workerAgent.doYouSupportExpectation(trackedExp.exp)

						if (support.support) {
							trackedExp.availableWorkers.push(workerAgent.id)
						} else {
							notSupportReason = support.reason
						}
					})
				)
				if (trackedExp.availableWorkers.length) {
					this.updateTrackedExp(
						trackedExp,
						TrackedExpectationState.WAITING,
						`Found ${trackedExp.availableWorkers.length} workers who supports this Expectation`
					)
					session.triggerExpectationAgain = true
				} else {
					this.updateTrackedExp(
						trackedExp,
						TrackedExpectationState.NEW,
						`Found no workers who supports this Expectation: "${notSupportReason}"`
					)
				}
			} else if (trackedExp.state === TrackedExpectationState.WAITING) {
				// Check if the expectation is ready to start:

				session.assignedWorker = session.assignedWorker || (await this.determineWorker(trackedExp))
				if (session.assignedWorker) {
					// First, check if it is already fulfilled:
					const fulfilled = await session.assignedWorker.worker.isExpectationFullfilled(trackedExp.exp, false)
					if (fulfilled.fulfilled) {
						// The expectation is already fulfilled:
						this.updateTrackedExp(trackedExp, TrackedExpectationState.FULFILLED, fulfilled.reason)
						if (this.handleTriggerByFullfilledIds(trackedExp)) {
							// Something was triggered, run again ASAP:
							session.triggerOtherExpectationsAgain = true
						}
					} else {
						const readyToStart = await this.isExpectationReadyToStartWorkingOn(
							session.assignedWorker.worker,
							trackedExp
						)
						if (readyToStart.ready) {
							this.updateTrackedExp(trackedExp, TrackedExpectationState.READY, 'Ready to start')
							session.triggerExpectationAgain = true
						} else {
							// Not ready to start
							this.updateTrackedExp(trackedExp, TrackedExpectationState.WAITING, readyToStart.reason)
						}
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExp(trackedExp, undefined, 'No workers available')
				}
			} else if (trackedExp.state === TrackedExpectationState.READY) {
				// Start working on it:

				session.assignedWorker = session.assignedWorker || (await this.determineWorker(trackedExp))
				if (session.assignedWorker) {
					this.updateTrackedExp(trackedExp, TrackedExpectationState.WORKING, 'Working')

					// Start working on the Expectation:
					trackedExp.workInProgress = await session.assignedWorker.worker.workOnExpectation(
						trackedExp.exp,
						session.assignedWorker.cost
					)
					this.updateTrackedExp(
						trackedExp,
						TrackedExpectationState.WORKING,
						trackedExp.workInProgress.workLabel
					)

					trackedExp.workInProgress.on('progress', (actualVersionHash: string | null, progress: number) => {
						if (trackedExp.state === TrackedExpectationState.WORKING) {
							trackedExp.actualVersionHash = actualVersionHash
							trackedExp.progress = progress

							this.logger.info(
								`Expectation "${JSON.stringify(
									trackedExp.exp.statusReport.label
								)}" progress: ${progress}`
							)

							this.reportExpectationStatus(trackedExp.id, trackedExp.exp, actualVersionHash, {
								progress: progress,
							})
						} else {
							// ignore
						}
					})
					trackedExp.workInProgress.on('error', (err: string) => {
						if (trackedExp.state === TrackedExpectationState.WORKING) {
							this.updateTrackedExp(trackedExp, TrackedExpectationState.WAITING, err)
							this.reportExpectationStatus(trackedExp.id, trackedExp.exp, null, {
								status: trackedExp.state,
								statusReason: trackedExp.reason,
							})
						} else {
							// ignore
						}
					})
					trackedExp.workInProgress.on('done', (actualVersionHash: string, reason: string, result: any) => {
						if (trackedExp.state === TrackedExpectationState.WORKING) {
							trackedExp.actualVersionHash = actualVersionHash
							this.updateTrackedExp(trackedExp, TrackedExpectationState.FULFILLED, reason)
							this.reportExpectationStatus(trackedExp.id, trackedExp.exp, actualVersionHash, {
								status: trackedExp.state,
								statusReason: trackedExp.reason,
								progress: 1,
							})

							if (trackedExp.handleResult) {
								trackedExp.handleResult(result)
							}
							if (this.handleTriggerByFullfilledIds(trackedExp)) {
								// Something was triggered, run again asap.
							}
							// We should reevaluate asap, so that any other expectation which might be waiting on this worker could start.
							this._triggerEvaluateExpectations(true)
						} else {
							// ignore
						}
					})
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExp(trackedExp, undefined, 'No workers available')
				}
			} else if (trackedExp.state === TrackedExpectationState.FULFILLED) {
				// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore?

				if (timeSinceLastEvaluation > this.FULLFILLED_MONITOR_TIME) {
					session.assignedWorker = session.assignedWorker || (await this.determineWorker(trackedExp))
					if (session.assignedWorker) {
						// Check if it is still fulfilled:
						const fulfilled = await session.assignedWorker.worker.isExpectationFullfilled(
							trackedExp.exp,
							true
						)
						if (fulfilled.fulfilled) {
							// Yes it is still fullfiled
							this.updateTrackedExp(trackedExp, TrackedExpectationState.FULFILLED, fulfilled.reason)
						} else {
							// It appears like it's not fullfilled anymore
							trackedExp.actualVersionHash = undefined
							trackedExp.progress = undefined
							this.updateTrackedExp(trackedExp, TrackedExpectationState.WAITING, fulfilled.reason)
							session.triggerExpectationAgain = true
						}
					} else {
						// No worker is available at the moment.
						// Do nothing, hopefully some will be available at a later iteration
						this.updateTrackedExp(trackedExp, undefined, 'No workers available')
					}
				}
			} else if (trackedExp.state === TrackedExpectationState.REMOVED) {
				session.assignedWorker = session.assignedWorker || (await this.determineWorker(trackedExp))
				if (session.assignedWorker) {
					const removed = await session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						session.expectationCanBeRemoved = true

						this.reportExpectationStatus(trackedExp.id, null, null, {})
					} else {
						this.updateTrackedExp(trackedExp, TrackedExpectationState.REMOVED, removed.reason)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExp(trackedExp, undefined, 'No workers available')
				}
			}
		} catch (err) {
			this.logger.error(err)
			this.updateTrackedExp(trackedExp, undefined, err.toString())
		}
		return session
	}
	private updateTrackedExp(
		trackedExp: TrackedExpectation,
		state: TrackedExpectationState | undefined,
		reason: string | undefined
	) {
		trackedExp.lastEvaluationTime = Date.now()

		const prevState = trackedExp.state
		let updatedState = false
		let updatedReason = false
		if (state !== undefined && trackedExp.state !== state) {
			trackedExp.state = state
			updatedState = true
		}

		if (trackedExp.reason !== reason) {
			trackedExp.reason = reason || 'N/A'
			updatedReason = true
		}
		// Log and report new states an reasons:
		if (updatedState) {
			this.logger.info(
				`${trackedExp.exp.statusReport.label}: New state: "${prevState}"->"${trackedExp.state}", reason: "${trackedExp.reason}"`
			)
		} else if (updatedReason) {
			this.logger.info(
				`${trackedExp.exp.statusReport.label}: State: "${trackedExp.state}", reason: "${trackedExp.reason}"`
			)
		}

		if (updatedState || updatedReason) {
			this.reportExpectationStatus(trackedExp.id, trackedExp.exp, null, {
				status: trackedExp.state,
				statusReason: trackedExp.reason,
			})

			this.updatePackageContainerPackageStatus(trackedExp)
		}
	}
	private updatePackageContainerPackageStatus(trackedExp: TrackedExpectation) {
		if (trackedExp.state === TrackedExpectationState.FULFILLED) {
			for (const fromPackage of trackedExp.exp.fromPackages) {
				// TODO: this is probably not eh right thing to do:
				for (const packageContainer of trackedExp.exp.endRequirement.targets) {
					this.reportPackageContainerPackageStatus(packageContainer.containerId, fromPackage.id, {
						contentVersionHash: trackedExp.actualVersionHash || '',
						progress: trackedExp.progress || 0,
						status:
							trackedExp.state === TrackedExpectationState.FULFILLED
								? PackageContainerPackageStatusStatus.READY
								: trackedExp.state === TrackedExpectationState.WORKING
								? PackageContainerPackageStatusStatus.TRANSFERRING
								: PackageContainerPackageStatusStatus.NOT_READY,
						statusReason: trackedExp.reason,
					})
				}
			}
			// [0].containerId
		}
	}
	private async determineWorker(trackedExp: TrackedExpectation): Promise<WorkerAgentAssignment | undefined> {
		/** How many requests to send out simultaneously */
		const batchSize = 10
		/** How many answers we want to have to be content */
		const minWorkerCount = batchSize / 2

		const workerCosts: WorkerAgentAssignment[] = []

		for (let i = 0; i < trackedExp.availableWorkers.length; i += batchSize) {
			const batchOfWorkers = trackedExp.availableWorkers.slice(i, i + batchSize)

			await Promise.all(
				batchOfWorkers.map(async (workerId) => {
					const worker = this._workforce.getWorkerAgent(workerId)
					if (worker) {
						const cost = await worker.worker.getCostForExpectation(trackedExp.exp)

						if (cost.cost < Number.POSITIVE_INFINITY) {
							workerCosts.push({
								worker: worker.worker,
								cost,
							})
						}
					}
				})
			)
			if (workerCosts.length >= minWorkerCount) break
		}

		workerCosts.sort((a, b) => {
			// Lowest cost first
			const aCost: number = a.cost.startCost + a.cost.cost
			const bCost: number = b.cost.startCost + b.cost.cost
			if (aCost > bCost) return 1
			if (aCost < bCost) return -1
			return 0
		})

		const bestWorker = workerCosts[0]

		if (bestWorker) {
			if (bestWorker.cost.startCost < 10) {
				// Only allow starting if the job can start in a short while
				return bestWorker
			}
		}
		return undefined
	}
	/**
	 * To be called when trackedExp.status turns fullfilled.
	 * Triggers any other expectations that listens to the fullfilled one.
	 */
	private handleTriggerByFullfilledIds(trackedExp: TrackedExpectation): boolean {
		let hasTriggeredSomething = false
		if (trackedExp.state === TrackedExpectationState.FULFILLED) {
			const toTriggerIds = this.triggerByFullfilledIds[trackedExp.id] || []

			for (const id of toTriggerIds) {
				const toTriggerExp = this.tracked[id]
				if (toTriggerExp) {
					toTriggerExp.lastEvaluationTime = 0 // so that it reruns ASAP
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
		// Intercept if
		if (trackedExp.exp.dependsOnFullfilled?.length) {
			// Check if those are fullfilled:
			let waitingFor: TrackedExpectation | undefined = undefined
			for (const id of trackedExp.exp.dependsOnFullfilled) {
				if (this.tracked[id].state !== TrackedExpectationState.FULFILLED) {
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
export enum TrackedExpectationState {
	NEW = 'new',
	WAITING = 'waiting',
	READY = 'ready',
	WORKING = 'working',
	FULFILLED = 'fulfilled',
	REMOVED = 'removed',
}
interface TrackedExpectation {
	id: string
	exp: Expectation.Any
	state: TrackedExpectationState
	/** List of worker ids that supports this Expectation */
	availableWorkers: string[]
	lastEvaluationTime: number
	reason: string
	workInProgress?: IWorkInProgress
	handleResult?: (result: any) => void
	actualVersionHash?: string | null
	progress?: number
}
interface ExpectationStateHandlerSession {
	/** Set to true if the tracked expectation should be triggered again ASAP */
	triggerExpectationAgain?: boolean
	/** Set to true if the other tracked expectations should be triggered again ASAP */
	triggerOtherExpectationsAgain?: boolean
	/** Set to true when the tracked expectation can safely be removed */
	expectationCanBeRemoved?: boolean

	/** The Worker assigned to the Expectation for this evaluation */
	assignedWorker: WorkerAgentAssignment | undefined
}
interface WorkerAgentAssignment {
	worker: WorkerAgent
	cost: ExpectationCost
}
