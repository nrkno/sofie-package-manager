import _ from 'underscore'
import {
	Expectation,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ClientConnectionOptions,
	ExpectationManagerWorkerAgent,
	WebsocketServer,
	ClientConnection,
	WorkForceExpectationManager,
	Hook,
	LoggerInstance,
	PackageContainerExpectation,
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

	/** Store for various incoming data, to be processed on next iteration round */
	private receivedUpdates: {
		/** Store for incoming Expectations */
		expectations: { [id: string]: Expectation.Any }
		/** Set to true when there have been changes to expectations.receivedUpdates */
		expectationsHasBeenUpdated: boolean

		/** Store for incoming PackageContainerExpectations */
		packageContainers: { [id: string]: PackageContainerExpectation }
		/** Set to true when there have been changes to expectations.receivedUpdates */
		packageContainersHasBeenUpdated: boolean

		/** Store for incoming Restart-calls */
		restartExpectations: { [id: string]: true }
		/** Store for incoming Abort-calls */
		abortExpectations: { [id: string]: true }
		/** Store for incoming RestartAll-calls */
		restartAllExpectations: boolean
	} = {
		expectations: {},
		expectationsHasBeenUpdated: false,
		packageContainers: {},
		packageContainersHasBeenUpdated: false,
		restartExpectations: {},
		abortExpectations: {},
		restartAllExpectations: false,
	}

	/** This is the main store of all Tracked Expectations */
	private trackedExpectations: { [id: string]: TrackedExpectation } = {}
	private trackedExpectationsCount = 0

	private trackedPackageContainers: { [id: string]: TrackedPackageContainerExpectation } = {}
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
		private serverOptions: ExpectationManagerServerOptions,
		/** At what url the ExpectationManager can be reached on */
		private serverAccessUrl: string | undefined,
		private workForceConnectionOptions: ClientConnectionOptions,
		private reportExpectationStatus: ReportExpectationStatus,
		private reportPackageContainerPackageStatus: ReportPackageContainerPackageStatus,
		private reportPackageContainerExpectationStatus: ReportPackageContainerExpectationStatus,
		private onMessageFromWorker: MessageFromWorker
	) {
		if (this.serverOptions.type === 'websocket') {
			this.logger.info(`Expectation Manager on port ${this.serverOptions.port}`)
			this.websocketServer = new WebsocketServer(this.serverOptions.port, (client: ClientConnection) => {
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
			})
		} else {
			// todo: handle direct connections
		}
	}

	/** Initialize the ExpectationManager. This method is should be called shortly after the class has been instantiated. */
	async init(): Promise<void> {
		await this.workforceAPI.init(this.managerId, this.workForceConnectionOptions, this)

		const serverAccessUrl =
			this.workForceConnectionOptions.type === 'internal' ? '__internal' : this.serverAccessUrl

		if (!serverAccessUrl) throw new Error(`ExpectationManager.serverAccessUrl not set!`)

		await this.workforceAPI.registerExpectationManager(this.managerId, serverAccessUrl)

		this._triggerEvaluateExpectations(true)
	}
	/** Used to hook into methods of Workforce directly (this is done when the server and client runs in the same process). */
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
	/** Returns a Hook used to hook up a WorkerAgent to our API-methods. */
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
	/** Called when there is an updated set of PackageContainerExpectations. */
	updatePackageContainerExpectations(packageContainers: { [id: string]: PackageContainerExpectation }): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.receivedUpdates.packageContainers = packageContainers
		this.receivedUpdates.packageContainersHasBeenUpdated = true

		this._triggerEvaluateExpectations(true)
	}
	/** Called when there is an updated set of Expectations. */
	updateExpectations(expectations: { [id: string]: Expectation.Any }): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.receivedUpdates.expectations = expectations
		this.receivedUpdates.expectationsHasBeenUpdated = true

		this._triggerEvaluateExpectations(true)
	}
	/** Request that an Expectation is restarted. This functions returns immediately, not waiting for a result. */
	restartExpectation(expectationId: string): void {
		this.receivedUpdates.restartExpectations[expectationId] = true
		this.receivedUpdates.expectationsHasBeenUpdated = true
		this._triggerEvaluateExpectations(true)
	}
	/** Request that all Expectations are restarted. This functions returns immediately, not waiting for a result. */
	restartAllExpectations(): void {
		this.receivedUpdates.restartAllExpectations = true
		this.receivedUpdates.expectationsHasBeenUpdated = true
		this._triggerEvaluateExpectations(true)
	}
	/** Request that an Expectation is aborted.
	 * "Aborted" means that any current work is cancelled and any finished work will be removed.
	 * Any future attempts to check on the Expectation will be ignored.
	 * To un-Abort, call this.restartExpectation().
	 * This functions returns immediately, not waiting for a result. */
	abortExpectation(expectationId: string): void {
		this.receivedUpdates.abortExpectations[expectationId] = true
		this.receivedUpdates.expectationsHasBeenUpdated = true
		this._triggerEvaluateExpectations(true)
	}
	/**
	 * Schedule the evaluateExpectations() to run
	 * @param asap If true, will re-schedule evaluateExpectations() to run as soon as possible
	 */
	private _triggerEvaluateExpectations(asap?: boolean): void {
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
			this._evaluateExpectationsRunAsap ? 1 : this.EVALUATE_INTERVAL
		)
	}
	/** Return the API-methods that the ExpectationManager exposes to the WorkerAgent */
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
				_result: any
			): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					if (wip.trackedExp.state === TrackedExpectationState.WORKING) {
						wip.trackedExp.status.actualVersionHash = actualVersionHash
						this.updateTrackedExpStatus(wip.trackedExp, TrackedExpectationState.FULFILLED, reason)
						this.reportExpectationStatus(wip.trackedExp.id, wip.trackedExp.exp, actualVersionHash, {
							status: wip.trackedExp.state,
							statusReason: wip.trackedExp.reason,
							progress: 1,
						})

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
						this.updateTrackedExpStatus(wip.trackedExp, TrackedExpectationState.WAITING, error)
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
	/**
	 * This is the main work-loop of the ExpectationManager.
	 * Evaluates the Expectations and PackageContainerExpectations
	 */
	private async _evaluateExpectations(): Promise<void> {
		this.logger.info(Date.now() / 1000 + ' _evaluateExpectations ----------')

		// First we're going to see if there is any new incoming data which needs to be pulled in.
		if (this.receivedUpdates.expectationsHasBeenUpdated) {
			await this.updateReceivedExpectations()
		}
		if (this.receivedUpdates.packageContainersHasBeenUpdated) {
			await this._updateReceivedPackageContainerExpectations()
		}
		// Update the count:
		this.trackedExpectationsCount = Object.keys(this.trackedExpectations).length

		/** If this is set to true, _evaluateExpectations() is going to be run again ASAP */
		let runAgainASAP = false

		// Iterate through the PackageContainerExpectations:
		await this._evaluateAllTrackedPackageContainers()

		// First, we're doing a run-through to just update the statues of the expectations.
		// The reason for this is that by updating all statuses we will have emitted at least one status for each expectation.
		// Updating the statuses should go fairly quickly, and emitting those statuses is important for the Sofie GUI.
		runAgainASAP = (await this._evaluateAllTrackedExpectations(false)) ? true : runAgainASAP

		// Then, we iterate through the Expectations again, now to do actual work:
		runAgainASAP = (await this._evaluateAllTrackedExpectations(true)) ? true : runAgainASAP

		if (runAgainASAP) {
			this._triggerEvaluateExpectations(true)
		}
	}
	/** Goes through the incoming data and stores it */
	private async updateReceivedExpectations(): Promise<void> {
		this.receivedUpdates.expectationsHasBeenUpdated = false

		// Added / Changed
		for (const id of Object.keys(this.receivedUpdates.expectations)) {
			const exp = this.receivedUpdates.expectations[id]

			let isNew = false
			let doUpdate = false
			if (!this.trackedExpectations[id]) {
				// new
				doUpdate = true
				isNew = true
			} else if (!_.isEqual(this.trackedExpectations[id].exp, exp)) {
				const trackedExp = this.trackedExpectations[id]

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
				this.trackedExpectations[id] = trackedExp
				if (isNew) {
					this.updateTrackedExpStatus(trackedExp, undefined, 'Added just now')
				} else {
					this.updateTrackedExpStatus(trackedExp, undefined, 'Updated just now')
				}
			}
		}

		// Removed:
		for (const id of Object.keys(this.trackedExpectations)) {
			if (!this.receivedUpdates.expectations[id]) {
				// This expectation has been removed
				// TODO: handled removed expectations!

				const trackedExp = this.trackedExpectations[id]

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
		if (this.receivedUpdates.restartAllExpectations) {
			for (const id of Object.keys(this.trackedExpectations)) {
				this.receivedUpdates.restartExpectations[id] = true
			}
		}
		this.receivedUpdates.restartAllExpectations = false

		for (const id of Object.keys(this.receivedUpdates.restartExpectations)) {
			const trackedExp = this.trackedExpectations[id]
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
		this.receivedUpdates.restartExpectations = {}

		// Aborted:
		for (const id of Object.keys(this.receivedUpdates.abortExpectations)) {
			const trackedExp = this.trackedExpectations[id]
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
		this.receivedUpdates.abortExpectations = {}

		this._triggerByFullfilledIds = {}
		for (const id of Object.keys(this.trackedExpectations)) {
			const trackedExp = this.trackedExpectations[id]
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
	/** Iterate through the tracked Expectations */
	private async _evaluateAllTrackedExpectations(allowStartWorking: boolean): Promise<boolean> {
		/** If this is set to true, we want _evaluateExpectations() to be run again ASAP */
		let runAgainASAP = false
		const startTime = Date.now()

		const removeIds: string[] = []

		const tracked: TrackedExpectation[] = Object.values(this.trackedExpectations)
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
			let assignedWorker: WorkerAgentAssignment | undefined = undefined
			let reiterateTrackedExp = true
			let runCount = 0
			while (reiterateTrackedExp) {
				reiterateTrackedExp = false
				runCount++
				const session: ExpectationStateHandlerSession = await this.evaluateTrackedExpectation(
					trackedExp,
					assignedWorker,
					allowStartWorking
				)
				assignedWorker = session.assignedWorker // So that this will be piped right into the evaluation on next pass
				if (session.triggerExpectationAgain && runCount < 10) {
					// Will cause this expectation to be evaluated again ASAP
					reiterateTrackedExp = true
				}
				if (session.triggerOtherExpectationsAgain || session.triggerExpectationAgain) {
					// Will cause another iteration of this._handleExpectations to be called again ASAP after this iteration has finished
					runAgainASAP = true
				}
				if (session.expectationCanBeRemoved) {
					// The tracked expectation can be removed
					removeIds.push(trackedExp.id)
				}
			}
			if (runAgainASAP && Date.now() - startTime > this.ALLOW_SKIPPING_QUEUE_TIME) {
				// Skip the rest of the queue, so that we don't get stuck on evaluating low-prio expectations.
				break
			}
			if (this.receivedUpdates.expectationsHasBeenUpdated) {
				// We have received new expectations. We should abort the evaluation-loop and restart from the beginning.
				// So that we don't miss any high-prio Expectations.
				runAgainASAP = true
				break
			}
		}
		for (const id of removeIds) {
			delete this.trackedExpectations[id]
		}
		return runAgainASAP
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
					this.updateTrackedExpStatus(
						trackedExp,
						TrackedExpectationState.WAITING,
						`Found ${trackedExp.availableWorkers.length} workers who supports this Expectation`
					)
					session.triggerExpectationAgain = true
				} else {
					this.updateTrackedExpStatus(
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
						this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.FULFILLED, fulfilled.reason)
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
							this.updateTrackedExpStatus(
								trackedExp,
								TrackedExpectationState.READY,
								'Ready to start',
								newStatus
							)
							session.triggerExpectationAgain = true
						} else {
							// Not ready to start
							this.updateTrackedExpStatus(
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
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						session.noAssignedWorkerReason || 'Unknown reason'
					)
				}
			} else if (trackedExp.state === TrackedExpectationState.READY) {
				// Start working on it:

				if (allowStartWorking) {
					await this.assignWorkerToSession(session, trackedExp)
					if (session.assignedWorker) {
						this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.WORKING, 'Working')

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

						this.updateTrackedExpStatus(
							trackedExp,
							TrackedExpectationState.WORKING,
							undefined,
							wipInfo.properties
						)
					} else {
						// No worker is available at the moment.
						// Do nothing, hopefully some will be available at a later iteration
						this.updateTrackedExpStatus(
							trackedExp,
							undefined,
							session.noAssignedWorkerReason || 'Unknown reason'
						)
					}
				} else {
					// Do nothing
					session.triggerOtherExpectationsAgain = true
				}
			} else if (trackedExp.state === TrackedExpectationState.FULFILLED) {
				// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore?

				if (timeSinceLastEvaluation > this.getFullfilledWaitTime()) {
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
							this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.WAITING, fulfilled.reason)
							session.triggerExpectationAgain = true
						}
					} else {
						// No worker is available at the moment.
						// Do nothing, hopefully some will be available at a later iteration
						this.updateTrackedExpStatus(
							trackedExp,
							undefined,
							session.noAssignedWorkerReason || 'Unknown reason'
						)
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
						this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.REMOVED, removed.reason)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						session.noAssignedWorkerReason || 'Unknown reason'
					)
				}
			} else if (trackedExp.state === TrackedExpectationState.RESTARTED) {
				await this.assignWorkerToSession(session, trackedExp)
				if (session.assignedWorker) {
					// Start by removing the expectation
					const removed = await session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.NEW, 'Ready to start')
						session.triggerExpectationAgain = true
					} else {
						this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.RESTARTED, removed.reason)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						session.noAssignedWorkerReason || 'Unknown reason'
					)
				}
			} else if (trackedExp.state === TrackedExpectationState.ABORTED) {
				await this.assignWorkerToSession(session, trackedExp)
				if (session.assignedWorker) {
					// Start by removing the expectation
					const removed = await session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						// This will cause the expectation to be intentionally stuck in the ABORTED state.
						this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.ABORTED, 'Aborted')
					} else {
						this.updateTrackedExpStatus(trackedExp, TrackedExpectationState.ABORTED, removed.reason)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						session.noAssignedWorkerReason || 'Unknown reason'
					)
				}
			}
		} catch (err) {
			this.logger.error(err)
			this.updateTrackedExpStatus(trackedExp, undefined, err.toString())
		}
		return session
	}
	/** Returns the appropriate time to wait before checking a fulfilled expectation again */
	private getFullfilledWaitTime(): number {
		return (
			// Default minimum time to wait:
			this.FULLFILLED_MONITOR_TIME +
			// Also add some more time, so that we don't check too often when we have a lot of expectations:
			this.trackedExpectationsCount * 0.02
		)
	}
	/** Update the state and status of a trackedExpectation */
	private updateTrackedExpStatus(
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
	/** Do a bidding between the available Workers and assign the cheapest one to use for the evaulation-session. */
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
				const toTriggerExp = this.trackedExpectations[id]
				if (toTriggerExp) {
					toTriggerExp.lastEvaluationTime = 0 // so that it reruns ASAP
					hasTriggeredSomething = true
				}
			}
		}
		return hasTriggeredSomething
	}
	/** Calls workerAgent.isExpectationReadyToStartWorkingOn() */
	private async isExpectationReadyToStartWorkingOn(
		workerAgent: WorkerAgentAPI,
		trackedExp: TrackedExpectation
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		// First check if the Expectation depends on the fullfilled-status of another Expectation:
		if (trackedExp.exp.dependsOnFullfilled?.length) {
			// Check if those are fullfilled:
			let waitingFor: TrackedExpectation | undefined = undefined
			for (const id of trackedExp.exp.dependsOnFullfilled) {
				if (this.trackedExpectations[id].state !== TrackedExpectationState.FULFILLED) {
					waitingFor = this.trackedExpectations[id]
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
	private async _updateReceivedPackageContainerExpectations() {
		this.receivedUpdates.packageContainersHasBeenUpdated = false

		// Added / Changed
		for (const id of Object.keys(this.receivedUpdates.packageContainers)) {
			const packageContainer: PackageContainerExpectation = this.receivedUpdates.packageContainers[id]

			let isNew = false
			let isUpdated = false
			if (!this.trackedPackageContainers[id]) {
				// new
				isUpdated = true
				isNew = true
			} else if (!_.isEqual(this.trackedPackageContainers[id].packageContainer, packageContainer)) {
				isUpdated = true
			}
			if (isNew) {
				const trackedPackageContainer: TrackedPackageContainerExpectation = {
					id: id,
					packageContainer: packageContainer,
					currentWorker: null,
					isUpdated: true,
					lastEvaluationTime: 0,
					status: {
						monitors: {},
					},
				}
				this.trackedPackageContainers[id] = trackedPackageContainer
			}
			if (isUpdated) {
				this.trackedPackageContainers[id].packageContainer = packageContainer
				this.trackedPackageContainers[id].isUpdated = true
			}
		}

		// Removed:
		for (const id of Object.keys(this.trackedPackageContainers)) {
			if (!this.receivedUpdates.packageContainers[id]) {
				// This packageContainersExpectation has been removed

				const trackedPackageContainer = this.trackedPackageContainers[id]
				if (trackedPackageContainer.currentWorker) {
					const workerAgent = this.workerAgents[trackedPackageContainer.currentWorker]
					if (workerAgent) {
						await workerAgent.api.disposePackageContainerMonitors(trackedPackageContainer.packageContainer)
					}
				}
			}
		}
	}
	private async _evaluateAllTrackedPackageContainers(): Promise<void> {
		for (const trackedPackageContainer of Object.values(this.trackedPackageContainers)) {
			if (trackedPackageContainer.isUpdated) {
				// If the packageContainer was newly updated, reset and set up again:
				if (trackedPackageContainer.currentWorker) {
					const workerAgent = this.workerAgents[trackedPackageContainer.currentWorker]
					const dispose = await workerAgent.api.disposePackageContainerMonitors(
						trackedPackageContainer.packageContainer
					)
					if (!dispose.disposed) {
						this.updateTrackedPackageContainerStatus(trackedPackageContainer, dispose.reason)
						continue // Break further execution for this PackageContainer
					}
					trackedPackageContainer.currentWorker = null
				}
				trackedPackageContainer.isUpdated = false
			}

			if (trackedPackageContainer.currentWorker) {
				// Check that the worker still exists:
				if (!this.workerAgents[trackedPackageContainer.currentWorker]) {
					trackedPackageContainer.currentWorker = null
				}
			}

			let currentWorkerIsNew = false
			if (!trackedPackageContainer.currentWorker) {
				// Find a worker
				let notSupportReason: string | null = null
				await Promise.all(
					Object.entries(this.workerAgents).map(async ([workerId, workerAgent]) => {
						const support = await workerAgent.api.doYouSupportPackageContainer(
							trackedPackageContainer.packageContainer
						)
						if (!trackedPackageContainer.currentWorker && support.support) {
							trackedPackageContainer.currentWorker = workerId
							currentWorkerIsNew = true
						} else {
							notSupportReason = support.reason
						}
					})
				)
				if (!trackedPackageContainer.currentWorker) {
					notSupportReason = 'Found no worker that supports this packageContainer'
				}
				if (notSupportReason) {
					this.updateTrackedPackageContainerStatus(trackedPackageContainer, notSupportReason)
					continue // Break further execution for this PackageContainer
				}
			}

			if (trackedPackageContainer.currentWorker) {
				const workerAgent = this.workerAgents[trackedPackageContainer.currentWorker]

				if (currentWorkerIsNew) {
					const monitorSetup = await workerAgent.api.setupPackageContainerMonitors(
						trackedPackageContainer.packageContainer
					)

					trackedPackageContainer.status.monitors = {}
					for (const [monitorId, monitor] of Object.entries(monitorSetup.monitors ?? {})) {
						trackedPackageContainer.status.monitors[monitorId] = {
							label: monitor.label,
							reason: 'Starting up',
						}
					}
				}
				const cronJobStatus = await workerAgent.api.runPackageContainerCronJob(
					trackedPackageContainer.packageContainer
				)
				if (!cronJobStatus.completed) {
					this.updateTrackedPackageContainerStatus(trackedPackageContainer, cronJobStatus.reason)
					continue
				}
			}
		}
	}
	private updateTrackedPackageContainerStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		reason: string | undefined
	) {
		trackedPackageContainer.lastEvaluationTime = Date.now()

		let updatedReason = false

		if (trackedPackageContainer.status.reason !== reason) {
			trackedPackageContainer.status.reason = reason || ''
			updatedReason = true
		}

		if (updatedReason) {
			this.logger.info(
				`${trackedPackageContainer.packageContainer.label}: Reason: "${trackedPackageContainer.status.reason}"`
			)
		}

		if (updatedReason) {
			this.reportPackageContainerExpectationStatus(
				trackedPackageContainer.id,
				trackedPackageContainer.packageContainer,
				{
					statusReason: trackedPackageContainer.status.reason,
				}
			)
		}
	}
}
export type ExpectationManagerServerOptions =
	| {
			type: 'websocket'
			/** Port of the websocket server */
			port: number
	  }
	| {
			type: 'internal'
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
	/** Unique ID of the tracked expectation */
	id: string
	/** The Expectation */
	exp: Expectation.Any

	/** The current State of the expectation. */
	state: TrackedExpectationState
	/** Human-readable reason for the current state. (To be used in GUIs) */
	reason: string

	/** List of worker ids that supports this Expectation */
	availableWorkers: string[]
	/** Timestamp of the last time the expectation was evaluated. */
	lastEvaluationTime: number

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
/** Contains some data which is persisted during an evaluation-session */
interface ExpectationStateHandlerSession {
	/** Set to true if the tracked expectation should be triggered again ASAP */
	triggerExpectationAgain?: boolean
	/** Set to true if the other tracked expectations should be triggered again ASAP */
	triggerOtherExpectationsAgain?: boolean
	/** Set to true when the tracked expectation can safely be removed */
	expectationCanBeRemoved?: boolean

	/** The Worker assigned to the Expectation during this evaluation-session */
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
export type ReportPackageContainerExpectationStatus = (
	containerId: string,
	packageContainer: PackageContainerExpectation | null,
	statusInfo: {
		statusReason?: string
	}
) => void
interface TrackedPackageContainerExpectation {
	/** Unique ID of the tracked packageContainer */
	id: string
	/** The PackageContainerExpectation */
	packageContainer: PackageContainerExpectation
	/** True whether the packageContainer was newly updated */
	isUpdated: boolean

	currentWorker: string | null

	/** Timestamp of the last time the expectation was evaluated. */
	lastEvaluationTime: number

	/** These statuses are sent from the workers */
	status: {
		reason?: string
		monitors: {
			[monitorId: string]: {
				label: string
				reason: string
			}
		}
	}
}
