import * as _ from 'underscore'
import {
	Expectation,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ClientConnectionOptions,
	ServerConnectionOptions,
	ExpectationManagerWorkerAgent,
	WebsocketServer,
	ClientConnection,
	WorkForceExpectationManager,
	Hook,
	LoggerInstance,
} from '@shared/api'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { WorkforceAPI } from './workforceApi'
import { WorkerAgentAPI } from './workerAgentApi'

/**
 * The Expectation Manager is responsible for tracking the state of the Expectations,
 * and communicate with the Workers to progress them.
 */

export class ExpectationManager {
	/** Time between iterations of the expectation queue */
	private readonly EVALUATE_INTERVAL = 10 * 1000 // ms
	/** Minimum time between re-evaluating fulfilled expectations */
	private readonly FULLFILLED_MONITOR_TIME = 10 * 1000 // ms
	/**
	 * If the iteration of the queue has been going for this time
	 * allow skipping the rest of the queue in order to reiterate the high-prio expectations
	 */
	private readonly ALLOW_SKIPPING_QUEUE_TIME = 30 * 1000 // ms

	private workforceAPI = new WorkforceAPI()

	/** Set to true when there are (external) updates to the expectations available */
	private receivedExpectationsHasBeenUpdated = false
	/** Store for incoming expectations */
	private receivedExpectations: { [id: string]: Expectation.Any } = {}
	private receivedRestartExpectations: { [id: string]: true } = {}
	private receivedAbortExpectations: { [id: string]: true } = {}
	private receivedRestartAllExpectations = false

	/** This is the main store of all Tracked Expectations */
	private tracked: { [id: string]: TrackedExpectation } = {}
	/** key-value store of which expectations are triggered when another is fullfilled */
	private _triggerByFullfilledIds: { [fullfilledId: string]: string[] } = {}

	private _evaluateExpectationsTimeout: NodeJS.Timeout | undefined = undefined
	private _evaluateExpectationsIsBusy = false
	private _evaluateExpectationsRunAsap = false

	private websocketServer?: WebsocketServer

	private workerAgents: {
		[workerId: string]: {
			api: WorkerAgentAPI
		}
	} = {}
	private worksInProgress: {
		[id: string]: {
			properties: ExpectationManagerWorkerAgent.WorkInProgressProperties
			trackedExp: TrackedExpectation
			worker: WorkerAgentAPI
		}
	} = {}
	private terminating = false

	constructor(
		private logger: LoggerInstance,
		public readonly managerId: string,
		private serverConnectionOptions: ServerConnectionOptions,
		/** At what url the ExpectationManager can be reached on */
		private serverAccessUrl: string | undefined,
		private workForceConnectionOptions: ClientConnectionOptions,
		private reportExpectationStatus: ReportExpectationStatus,
		private reportPackageContainerPackageStatus: ReportPackageContainerPackageStatus,
		private onMessageFromWorker: MessageFromWorker
	) {
		if (this.serverConnectionOptions.type === 'websocket') {
			this.logger.info(`Expectation Manager on port ${this.serverConnectionOptions.port}`)
			this.websocketServer = new WebsocketServer(
				this.serverConnectionOptions.port,
				(client: ClientConnection) => {
					// A new client has connected

					this.logger.info(`New ${client.clientType} connected, id "${client.clientId}"`)

					if (client.clientType === 'workerAgent') {
						const expectationManagerMethods = this.getWorkerAgentAPI(client.clientId)

						const api = new WorkerAgentAPI(expectationManagerMethods, {
							type: 'websocket',
							clientConnection: client,
						})

						this.workerAgents[client.clientId] = { api }
					} else {
						throw new Error(`Unknown clientType "${client.clientType}"`)
					}
				}
			)
		} else {
			// todo: handle direct connections
		}
	}

	async init(): Promise<void> {
		await this.workforceAPI.init(this.managerId, this.workForceConnectionOptions, this)

		const serverAccessUrl =
			this.workForceConnectionOptions.type === 'internal' ? '__internal' : this.serverAccessUrl

		if (!serverAccessUrl) throw new Error(`ExpectationManager.serverAccessUrl not set!`)

		await this.workforceAPI.registerExpectationManager(this.managerId, serverAccessUrl)

		this._triggerEvaluateExpectations(true)
	}
	hookToWorkforce(
		hook: Hook<WorkForceExpectationManager.WorkForce, WorkForceExpectationManager.ExpectationManager>
	): void {
		this.workforceAPI.hook(hook)
	}
	terminate(): void {
		this.terminating = true
		if (this.websocketServer) {
			this.websocketServer.terminate()
		}
	}
	getWorkerAgentHook(): Hook<
		ExpectationManagerWorkerAgent.ExpectationManager,
		ExpectationManagerWorkerAgent.WorkerAgent
	> {
		return (clientId: string, clientMethods: ExpectationManagerWorkerAgent.WorkerAgent) => {
			// On connection from a workerAgent

			const workerAgentMethods = this.getWorkerAgentAPI(clientId)
			const api = new WorkerAgentAPI(workerAgentMethods, {
				type: 'internal',
				hookMethods: clientMethods,
			})
			this.workerAgents[clientId] = { api }

			return workerAgentMethods
		}
	}

	/** Called when there is an updated set of expectations */
	updateExpectations(expectations: { [id: string]: Expectation.Any }): void {
		// We store the incoming expectations in this temporary
		this.receivedExpectations = expectations
		this.receivedExpectationsHasBeenUpdated = true

		this._triggerEvaluateExpectations(true)
	}
	restartExpectation(expectationId: string): void {
		this.receivedRestartExpectations[expectationId] = true
		this.receivedExpectationsHasBeenUpdated = true
		this._triggerEvaluateExpectations(true)
	}
	restartAllExpectations(): void {
		this.receivedRestartAllExpectations = true
		this.receivedExpectationsHasBeenUpdated = true
		this._triggerEvaluateExpectations(true)
	}
	abortExpectation(expectationId: string): void {
		this.receivedAbortExpectations[expectationId] = true
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

		if (this.terminating) return

		this._evaluateExpectationsTimeout = setTimeout(
			() => {
				if (this.terminating) return

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
	/** Return the API-methods that the WxpectationManager exposes to the WorkerAgent */
	private getWorkerAgentAPI(clientId: string): ExpectationManagerWorkerAgent.ExpectationManager {
		return {
			messageFromWorker: async (
				message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any
			): Promise<any> => {
				return this.onMessageFromWorker(message)
			},

			wipEventProgress: async (
				wipId: number,
				actualVersionHash: string | null,
				progress: number
			): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					if (wip.trackedExp.state === TrackedExpectationState.WORKING) {
						wip.trackedExp.status.actualVersionHash = actualVersionHash
						wip.trackedExp.status.workProgress = progress

						this.logger.info(
							`Expectation "${JSON.stringify(
								wip.trackedExp.exp.statusReport.label
							)}" progress: ${progress}`
						)

						this.reportExpectationStatus(wip.trackedExp.id, wip.trackedExp.exp, actualVersionHash, {
							progress: progress,
						})
					} else {
						// ignore
					}
				}
			},
			wipEventDone: async (
				wipId: number,
				actualVersionHash: string,
				reason: string,
				result: any
			): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					if (wip.trackedExp.state === TrackedExpectationState.WORKING) {
						wip.trackedExp.status.actualVersionHash = actualVersionHash
						this.updateTrackedExp(wip.trackedExp, TrackedExpectationState.FULFILLED, reason)
						this.reportExpectationStatus(wip.trackedExp.id, wip.trackedExp.exp, actualVersionHash, {
							status: wip.trackedExp.state,
							statusReason: wip.trackedExp.reason,
							progress: 1,
						})

						if (wip.trackedExp.handleResult) {
							wip.trackedExp.handleResult(result)
						}
						if (this.handleTriggerByFullfilledIds(wip.trackedExp)) {
							// Something was triggered, run again asap.
						}
						// We should reevaluate asap, so that any other expectation which might be waiting on this worker could start.
						this._triggerEvaluateExpectations(true)
					} else {
						// ignore
					}
					delete this.worksInProgress[`${clientId}_${wipId}`]
				}
			},
			wipEventError: async (wipId: number, error: string): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					if (wip.trackedExp.state === TrackedExpectationState.WORKING) {
						this.updateTrackedExp(wip.trackedExp, TrackedExpectationState.WAITING, error)
						this.reportExpectationStatus(wip.trackedExp.id, wip.trackedExp.exp, null, {
							status: wip.trackedExp.state,
							statusReason: wip.trackedExp.reason,
						})
					} else {
						// ignore
					}
					delete this.worksInProgress[`${clientId}_${wipId}`]
				}
			},
		}
	}
	private async _evaluateExpectations(): Promise<void> {
		this.logger.info(Date.now() / 1000 + ' _evaluateExpectations ----------')
		if (this.receivedExpectationsHasBeenUpdated) {
			await this.updateReceivedExpectations()
		}
		let runAgainASAP = false

		const iterateThroughTrackedExpectation = async (allowStartWorking: boolean): Promise<void> => {
			const startTime = Date.now()

			const removeIds: string[] = []

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
			for (const trackedExp of tracked) {
				let assignedWorker: WorkerAgentAssignment | undefined
				let reiterateTrackedExp = true
				let runCount = 0
				while (reiterateTrackedExp) {
					reiterateTrackedExp = false
					runCount++
					const session = await this.evaluateTrackedExpectation(trackedExp, assignedWorker, allowStartWorking)
					assignedWorker = session.assignedWorker // So that this will be piped right into the evaluation on next pass
					if (session.triggerExpectationAgain && runCount < 10) {
						// Will cause this expectation to be evaluated again ASAP
						reiterateTrackedExp = true
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
		}

		// First, we're doing a run-through of the expectations in order to have all statuses updated:
		await iterateThroughTrackedExpectation(false)

		// Then, we iterate through the expectations, now to do actual work:
		await iterateThroughTrackedExpectation(true)

		if (runAgainASAP) {
			this._triggerEvaluateExpectations(true)
		}
	}
	private async updateReceivedExpectations(): Promise<void> {
		this.receivedExpectationsHasBeenUpdated = false

		// Added / Changed
		for (const id of Object.keys(this.receivedExpectations)) {
			const exp = this.receivedExpectations[id]

			let isNew = false
			let doUpdate = false
			if (!this.tracked[id]) {
				// new
				doUpdate = true
				isNew = true
			} else if (!_.isEqual(this.tracked[id].exp, exp)) {
				const trackedExp = this.tracked[id]

				if (trackedExp.state == TrackedExpectationState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.info(`Cancelling ${trackedExp.id} due to update`)
						await trackedExp.status.workInProgressCancel()
					}
				}
				doUpdate = true
			}
			if (doUpdate) {
				const trackedExp: TrackedExpectation = {
					id: id,
					exp: exp,
					state: TrackedExpectationState.NEW,
					availableWorkers: [],
					lastEvaluationTime: 0,
					reason: '',
					status: {},
				}
				this.tracked[id] = trackedExp
				if (isNew) {
					this.updateTrackedExp(trackedExp, undefined, 'Added just now')
				} else {
					this.updateTrackedExp(trackedExp, undefined, 'Updated just now')
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
					if (trackedExp.status.workInProgressCancel) {
						this.logger.info(`Cancelling ${trackedExp.id} due to removed`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				trackedExp.state = TrackedExpectationState.REMOVED
				trackedExp.lastEvaluationTime = 0 // To rerun ASAP
			}
		}

		// Restarted:
		if (this.receivedRestartAllExpectations) {
			for (const id of Object.keys(this.tracked)) {
				this.receivedRestartExpectations[id] = true
			}
		}
		this.receivedRestartAllExpectations = false

		for (const id of Object.keys(this.receivedRestartExpectations)) {
			const trackedExp = this.tracked[id]
			if (trackedExp) {
				if (trackedExp.state == TrackedExpectationState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.info(`Cancelling ${trackedExp.id} due to restart`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				trackedExp.state = TrackedExpectationState.RESTARTED
				trackedExp.lastEvaluationTime = 0 // To rerun ASAP
			}
		}
		this.receivedRestartExpectations = {}

		// Aborted:
		for (const id of Object.keys(this.receivedAbortExpectations)) {
			const trackedExp = this.tracked[id]
			if (trackedExp) {
				if (trackedExp.state == TrackedExpectationState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.info(`Cancelling ${trackedExp.id} due to abort`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				trackedExp.state = TrackedExpectationState.ABORTED
			}
		}
		this.receivedAbortExpectations = {}

		this._triggerByFullfilledIds = {}
		for (const id of Object.keys(this.tracked)) {
			const trackedExp = this.tracked[id]
			if (trackedExp.exp.triggerByFullfilledIds) {
				for (const triggerByFullfilledId of trackedExp.exp.triggerByFullfilledIds) {
					if (triggerByFullfilledId === id) {
						throw new Error(`triggerByFullfilledIds not allowed to contain it's own id: "${id}"`)
					}

					if (!this._triggerByFullfilledIds[triggerByFullfilledId]) {
						this._triggerByFullfilledIds[triggerByFullfilledId] = []
					}
					this._triggerByFullfilledIds[triggerByFullfilledId].push(trackedExp.id)
				}
			}
		}
	}
	async evaluateTrackedExpectation(
		trackedExp: TrackedExpectation,
		assignedWorker0: WorkerAgentAssignment | undefined,
		allowStartWorking: boolean
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

				// Reset properties:
				trackedExp.availableWorkers = []
				trackedExp.status = {}

				let notSupportReason = 'No workers registered'
				await Promise.all(
					Object.entries(this.workerAgents).map(async ([id, workerAgent]) => {
						const support = await workerAgent.api.doYouSupportExpectation(trackedExp.exp)

						if (support.support) {
							trackedExp.availableWorkers.push(id)
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

				await this.assignWorkerToSession(session, trackedExp)

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

						const newStatus: Partial<TrackedExpectation['status']> = {}
						if (readyToStart.sourceExists !== undefined) newStatus.sourceExists = readyToStart.sourceExists

						if (readyToStart.ready) {
							this.updateTrackedExp(
								trackedExp,
								TrackedExpectationState.READY,
								'Ready to start',
								newStatus
							)
							session.triggerExpectationAgain = true
						} else {
							// Not ready to start
							this.updateTrackedExp(
								trackedExp,
								TrackedExpectationState.WAITING,
								readyToStart.reason,
								newStatus
							)
						}
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExp(trackedExp, undefined, session.noAssignedWorkerReason || 'Unknown reason')
				}
			} else if (trackedExp.state === TrackedExpectationState.READY) {
				// Start working on it:

				if (allowStartWorking) {
					await this.assignWorkerToSession(session, trackedExp)
					if (session.assignedWorker) {
						this.updateTrackedExp(trackedExp, TrackedExpectationState.WORKING, 'Working')

						// Start working on the Expectation:
						const wipInfo = await session.assignedWorker.worker.workOnExpectation(
							trackedExp.exp,
							session.assignedWorker.cost
						)
						trackedExp.status.workInProgressCancel = async () => {
							await session.assignedWorker?.worker.cancelWorkInProgress(wipInfo.wipId)
							delete trackedExp.status.workInProgressCancel
						}

						// trackedExp.status.workInProgress = new WorkInProgressReceiver(wipInfo.properties)
						this.worksInProgress[`${session.assignedWorker.id}_${wipInfo.wipId}`] = {
							properties: wipInfo.properties,
							trackedExp: trackedExp,
							worker: session.assignedWorker.worker,
						}

						this.updateTrackedExp(
							trackedExp,
							TrackedExpectationState.WORKING,
							undefined,
							wipInfo.properties
						)
					} else {
						// No worker is available at the moment.
						// Do nothing, hopefully some will be available at a later iteration
						this.updateTrackedExp(trackedExp, undefined, session.noAssignedWorkerReason || 'Unknown reason')
					}
				} else {
					// Do nothing
				}
			} else if (trackedExp.state === TrackedExpectationState.FULFILLED) {
				// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore?

				if (timeSinceLastEvaluation > this.FULLFILLED_MONITOR_TIME) {
					await this.assignWorkerToSession(session, trackedExp)
					if (session.assignedWorker) {
						// Check if it is still fulfilled:
						const fulfilled = await session.assignedWorker.worker.isExpectationFullfilled(
							trackedExp.exp,
							true
						)
						if (fulfilled.fulfilled) {
							// Yes it is still fullfiled
							// No need to update the tracked state, since it's already fullfilled:
							// this.updateTrackedExp(trackedExp, TrackedExpectationState.FULFILLED, fulfilled.reason)
						} else {
							// It appears like it's not fullfilled anymore
							trackedExp.status.actualVersionHash = undefined
							trackedExp.status.workProgress = undefined
							this.updateTrackedExp(trackedExp, TrackedExpectationState.WAITING, fulfilled.reason)
							session.triggerExpectationAgain = true
						}
					} else {
						// No worker is available at the moment.
						// Do nothing, hopefully some will be available at a later iteration
						this.updateTrackedExp(trackedExp, undefined, session.noAssignedWorkerReason || 'Unknown reason')
					}
				} else {
					// Do nothing
				}
			} else if (trackedExp.state === TrackedExpectationState.REMOVED) {
				await this.assignWorkerToSession(session, trackedExp)
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
					this.updateTrackedExp(trackedExp, undefined, session.noAssignedWorkerReason || 'Unknown reason')
				}
			} else if (trackedExp.state === TrackedExpectationState.RESTARTED) {
				await this.assignWorkerToSession(session, trackedExp)
				if (session.assignedWorker) {
					// Start by removing the expectation
					const removed = await session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						this.updateTrackedExp(trackedExp, TrackedExpectationState.NEW, 'Ready to start')
						session.triggerExpectationAgain = true
					} else {
						this.updateTrackedExp(trackedExp, TrackedExpectationState.RESTARTED, removed.reason)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExp(trackedExp, undefined, session.noAssignedWorkerReason || 'Unknown reason')
				}
			} else if (trackedExp.state === TrackedExpectationState.ABORTED) {
				await this.assignWorkerToSession(session, trackedExp)
				if (session.assignedWorker) {
					// Start by removing the expectation
					const removed = await session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						// This will cause the expectation to be intentionally stuck in the ABORTED state.
						this.updateTrackedExp(trackedExp, TrackedExpectationState.ABORTED, 'Aborted')
					} else {
						this.updateTrackedExp(trackedExp, TrackedExpectationState.ABORTED, removed.reason)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExp(trackedExp, undefined, session.noAssignedWorkerReason || 'Unknown reason')
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
		reason: string | undefined,
		newStatus?: Partial<TrackedExpectation['status']>
	) {
		trackedExp.lastEvaluationTime = Date.now()

		const prevState = trackedExp.state
		const prevStatus = trackedExp.status

		let updatedState = false
		let updatedReason = false
		let updatedStatus = false

		if (state !== undefined && trackedExp.state !== state) {
			trackedExp.state = state
			updatedState = true
		}

		if (trackedExp.reason !== reason) {
			trackedExp.reason = reason || ''
			updatedReason = true
		}
		const status = Object.assign({}, trackedExp.status, newStatus) // extend with new values
		if (!_.isEqual(prevStatus, status)) {
			Object.assign(trackedExp.status, newStatus)
			updatedStatus = true
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
		}
		if (updatedState || updatedReason || updatedStatus) {
			this.updatePackageContainerPackageStatus(trackedExp)
		}
	}
	private updatePackageContainerPackageStatus(trackedExp: TrackedExpectation) {
		if (trackedExp.state === TrackedExpectationState.FULFILLED) {
			for (const fromPackage of trackedExp.exp.fromPackages) {
				// TODO: this is probably not eh right thing to do:
				for (const packageContainer of trackedExp.exp.endRequirement.targets) {
					this.reportPackageContainerPackageStatus(packageContainer.containerId, fromPackage.id, {
						contentVersionHash: trackedExp.status.actualVersionHash || '',
						progress: trackedExp.status.workProgress || 0,
						status: this.getPackageStatus(trackedExp),
						statusReason: trackedExp.reason,

						isPlaceholder: !!trackedExp.status.sourceIsPlaceholder,
					})
				}
			}
		}
	}
	/** Convert expectation status to ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus */
	private getPackageStatus(
		trackedExp: TrackedExpectation
	): ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus {
		if (trackedExp.state === TrackedExpectationState.FULFILLED) {
			return ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		} else if (trackedExp.state === TrackedExpectationState.WORKING) {
			return trackedExp.status.targetCanBeUsedWhileTransferring
				? ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.TRANSFERRING_READY
				: ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.TRANSFERRING_NOT_READY
		} else {
			return trackedExp.status.sourceExists
				? ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_READY
				: ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_FOUND
		}
	}
	private async assignWorkerToSession(
		session: ExpectationStateHandlerSession,
		trackedExp: TrackedExpectation
	): Promise<void> {
		if (session.assignedWorker) return // A worker has already been assigned

		/** How many requests to send out simultaneously */
		const batchSize = 10
		/** How many answers we want to have to be content */
		const minWorkerCount = batchSize / 2

		if (!trackedExp.availableWorkers.length) {
			session.noAssignedWorkerReason = 'No workers available'
		}

		const workerCosts: WorkerAgentAssignment[] = []

		for (let i = 0; i < trackedExp.availableWorkers.length; i += batchSize) {
			const batchOfWorkers = trackedExp.availableWorkers.slice(i, i + batchSize)

			await Promise.all(
				batchOfWorkers.map(async (workerId) => {
					const workerAgent = this.workerAgents[workerId]
					if (workerAgent) {
						const cost = await workerAgent.api.getCostForExpectation(trackedExp.exp)

						if (cost.cost < Number.POSITIVE_INFINITY) {
							workerCosts.push({
								worker: workerAgent.api,
								id: workerId,
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

		if (bestWorker && bestWorker.cost.startCost < 10) {
			// Only allow starting if the job can start in a short while
			session.assignedWorker = bestWorker
		} else {
			session.noAssignedWorkerReason = `Waiting for a free worker (${trackedExp.availableWorkers.length} busy)`
		}
	}
	/**
	 * To be called when trackedExp.status turns fullfilled.
	 * Triggers any other expectations that listens to the fullfilled one.
	 */
	private handleTriggerByFullfilledIds(trackedExp: TrackedExpectation): boolean {
		let hasTriggeredSomething = false
		if (trackedExp.state === TrackedExpectationState.FULFILLED) {
			const toTriggerIds = this._triggerByFullfilledIds[trackedExp.id] || []

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
		workerAgent: WorkerAgentAPI,
		trackedExp: TrackedExpectation
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
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
/** Denotes the various states of a Tracked Expectation */
export enum TrackedExpectationState {
	NEW = 'new',
	WAITING = 'waiting',
	READY = 'ready',
	WORKING = 'working',
	FULFILLED = 'fulfilled',
	REMOVED = 'removed',

	// Triggered from Core:
	RESTARTED = 'restarted',
	ABORTED = 'aborted',
}
interface TrackedExpectation {
	id: string
	exp: Expectation.Any

	state: TrackedExpectationState
	reason: string

	/** List of worker ids that supports this Expectation */
	availableWorkers: string[]
	lastEvaluationTime: number
	handleResult?: (result: any) => void

	/** These statuses are sent from the workers */
	status: {
		workProgress?: number
		// workInProgress?: IWorkInProgress
		workInProgressCancel?: () => Promise<void>
		actualVersionHash?: string | null

		sourceExists?: boolean
		targetCanBeUsedWhileTransferring?: boolean
		sourceIsPlaceholder?: boolean // todo: to be implemented (quantel)
	}
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
	noAssignedWorkerReason?: string
}
interface WorkerAgentAssignment {
	worker: WorkerAgentAPI
	id: string
	cost: ExpectationManagerWorkerAgent.ExpectationCost
}
export type MessageFromWorker = (message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any) => Promise<any>

export type ReportExpectationStatus = (
	expectationId: string,
	expectaction: Expectation.Any | null,
	actualVersionHash: string | null,
	statusInfo: {
		status?: string
		progress?: number
		statusReason?: string
	}
) => void
export type ReportPackageContainerPackageStatus = (
	containerId: string,
	packageId: string,
	packageStatus: ExpectedPackageStatusAPI.PackageContainerPackageStatus | null
) => void
