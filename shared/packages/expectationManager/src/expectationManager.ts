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
	Reason,
} from '@shared/api'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { WorkforceAPI } from './workforceApi'
import { WorkerAgentAPI } from './workerAgentApi'
import PromisePool from '@supercharge/promise-pool'

/**
 * The Expectation Manager is responsible for tracking the state of the Expectations,
 * and communicate with the Workers to progress them.
 * @see FOR_DEVELOPERS.md
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

	private workforceAPI: WorkforceAPI

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
		private callbacks: ExpectationManagerCallbacks
	) {
		this.workforceAPI = new WorkforceAPI(this.logger)
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
				return this.callbacks.messageFromWorker(message)
			},

			wipEventProgress: async (
				wipId: number,
				actualVersionHash: string | null,
				progress: number
			): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						wip.trackedExp.status.actualVersionHash = actualVersionHash
						wip.trackedExp.status.workProgress = progress

						this.logger.info(
							`Expectation "${JSON.stringify(
								wip.trackedExp.exp.statusReport.label
							)}" progress: ${progress}`
						)

						this.callbacks.reportExpectationStatus(
							wip.trackedExp.id,
							wip.trackedExp.exp,
							actualVersionHash,
							{
								progress: progress,
							}
						)
					} else {
						// ignore
					}
				}
			},
			wipEventDone: async (
				wipId: number,
				actualVersionHash: string,
				reason: Reason,
				_result: any
			): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						wip.trackedExp.status.actualVersionHash = actualVersionHash
						this.updateTrackedExpStatus(
							wip.trackedExp,
							ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
							reason
						)
						this.callbacks.reportExpectationStatus(
							wip.trackedExp.id,
							wip.trackedExp.exp,
							actualVersionHash,
							{
								status: wip.trackedExp.state,
								statusReason: wip.trackedExp.reason,
								progress: 1,
							}
						)

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
			wipEventError: async (wipId: number, reason: Reason): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						wip.trackedExp.errorCount++
						this.updateTrackedExpStatus(
							wip.trackedExp,
							ExpectedPackageStatusAPI.WorkStatusState.WAITING,
							reason
						)
						this.callbacks.reportExpectationStatus(wip.trackedExp.id, wip.trackedExp.exp, null, {
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

		// Iterate through the PackageContainerExpectations:
		await this._evaluateAllTrackedPackageContainers()

		// Iterate through all Expectations:
		const runAgainASAP = await this._evaluateAllExpectations()

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

				if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
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
					state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					availableWorkers: [],
					lastEvaluationTime: 0,
					errorCount: 0,
					reason: {
						user: '',
						tech: '',
					},
					status: {},
					session: null,
				}
				this.trackedExpectations[id] = trackedExp
				if (isNew) {
					this.updateTrackedExpStatus(trackedExp, undefined, {
						user: `Added just now`,
						tech: `Added ${Date.now()}`,
					})
				} else {
					this.updateTrackedExpStatus(trackedExp, undefined, {
						user: `Updated just now`,
						tech: `Updated ${Date.now()}`,
					})
				}
			}
		}

		// Removed:
		for (const id of Object.keys(this.trackedExpectations)) {
			this.trackedExpectations[id].errorCount = 0 // Also reset the errorCount, to start fresh.

			if (!this.receivedUpdates.expectations[id]) {
				// This expectation has been removed
				// TODO: handled removed expectations!

				const trackedExp = this.trackedExpectations[id]

				if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.info(`Cancelling ${trackedExp.id} due to removed`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				trackedExp.state = ExpectedPackageStatusAPI.WorkStatusState.REMOVED
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
				if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.info(`Cancelling ${trackedExp.id} due to restart`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				trackedExp.state = ExpectedPackageStatusAPI.WorkStatusState.RESTARTED
				trackedExp.lastEvaluationTime = 0 // To rerun ASAP
			}
		}
		this.receivedUpdates.restartExpectations = {}

		// Aborted:
		for (const id of Object.keys(this.receivedUpdates.abortExpectations)) {
			const trackedExp = this.trackedExpectations[id]
			if (trackedExp) {
				if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
					if (trackedExp.status.workInProgressCancel) {
						this.logger.info(`Cancelling ${trackedExp.id} due to abort`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				trackedExp.state = ExpectedPackageStatusAPI.WorkStatusState.ABORTED
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
	private getTrackedExpectations(): TrackedExpectation[] {
		const tracked: TrackedExpectation[] = Object.values(this.trackedExpectations)
		tracked.sort((a, b) => {
			// Lowest errorCount first, this is to make it so that if one expectation fails, it'll not block all the others
			if (a.errorCount > b.errorCount) return 1
			if (a.errorCount < b.errorCount) return -1

			// Lowest priority first
			if (a.exp.priority > b.exp.priority) return 1
			if (a.exp.priority < b.exp.priority) return -1

			// Lowest lastOperationTime first
			if (a.lastEvaluationTime > b.lastEvaluationTime) return 1
			if (a.lastEvaluationTime < b.lastEvaluationTime) return -1

			return 0
		})
		return tracked
	}
	/** Iterate through the tracked Expectations */
	private async _evaluateAllExpectations(): Promise<boolean> {
		/** If this is set to true, we want _evaluateExpectations() to be run again ASAP */
		let runAgainASAP = false
		const startTime = Date.now()

		const removeIds: string[] = []

		const tracked = this.getTrackedExpectations()

		// Step 0: Reset the session:
		for (const trackedExp of tracked) {
			trackedExp.session = null
		}

		// Step 1: Evaluate the Expectations which are in the states that can be handled in parallel:
		for (const handleState of [
			// Note: The order of these is important, as the states normally progress in this order:
			ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
			ExpectedPackageStatusAPI.WorkStatusState.NEW,
			ExpectedPackageStatusAPI.WorkStatusState.WAITING,
			ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
		]) {
			// Filter out the ones that are in the state we're about to handle:
			const trackedWithState = tracked.filter((trackedExp) => trackedExp.state === handleState)

			if (trackedWithState.length) {
				this.logger.info(`Handle state ${handleState}, ${trackedWithState.length} expectations..`)
			}

			if (trackedWithState.length) {
				// We're using a PromisePool so that we don't send out an unlimited number of parallel requests to the workers.
				const CONCURRENCY = 100
				await PromisePool.for(trackedWithState)
					.withConcurrency(CONCURRENCY)
					.handleError(async (error, trackedExp) => {
						// Log the error
						this.logger.error(error.name + error.message)
						if (trackedExp.session) {
							// Mark the expectation so that it won't be evaluated again this round:
							trackedExp.session.hadError = true
						}
					})
					.process(async (trackedExp) => {
						await this.evaluateExpectationState(trackedExp)
					})
			}
		}

		this.logger.info(`Handle other states..`)

		// Step 1.5: Reset the session:
		// Because during the next iteration, the worker-assignment need to be done in series
		for (const trackedExp of tracked) {
			trackedExp.session = null
		}

		// Step 2: Evaluate the expectations, now one by one:
		for (const trackedExp of tracked) {
			let reiterateTrackedExp = true
			let runCount = 0
			while (reiterateTrackedExp) {
				reiterateTrackedExp = false
				runCount++
				await this.evaluateExpectationState(trackedExp)
				if (trackedExp.session?.triggerExpectationAgain && runCount < 10) {
					// Will cause this expectation to be evaluated again ASAP
					reiterateTrackedExp = true
				}
				if (trackedExp.session?.triggerOtherExpectationsAgain || trackedExp.session?.triggerExpectationAgain) {
					// Will cause another iteration of this._handleExpectations to be called again ASAP after this iteration has finished
					runAgainASAP = true
				}
				if (trackedExp.session?.expectationCanBeRemoved) {
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
	/** Evaluate the state of an Expectation */
	private async evaluateExpectationState(trackedExp: TrackedExpectation): Promise<void> {
		const timeSinceLastEvaluation = Date.now() - trackedExp.lastEvaluationTime
		if (!trackedExp.session) trackedExp.session = {}
		if (trackedExp.session.hadError) return // do nothing

		try {
			if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW) {
				// Check which workers might want to handle it:

				// Reset properties:
				trackedExp.availableWorkers = []
				trackedExp.status = {}

				let notSupportReason: Reason = {
					user: 'No workers registered (this is likely a configuration issue)',
					tech: 'No workers registered',
				}
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
					this.updateTrackedExpStatus(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.WAITING, {
						user: `${trackedExp.availableWorkers.length} workers available, about to start...`,
						tech: `Found ${trackedExp.availableWorkers.length} workers who supports this Expectation`,
					})
					trackedExp.session.triggerExpectationAgain = true
				} else {
					this.updateTrackedExpStatus(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.NEW, {
						user: `Found no workers who supports this Expectation, due to: ${notSupportReason.user}`,
						tech: `Found no workers who supports this Expectation: "${notSupportReason.tech}"`,
					})
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
				// Check if the expectation is ready to start:

				await this.assignWorkerToSession(trackedExp.session, trackedExp)

				if (trackedExp.session.assignedWorker) {
					// First, check if it is already fulfilled:
					const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFullfilled(
						trackedExp.exp,
						false
					)
					if (fulfilled.fulfilled) {
						// The expectation is already fulfilled:
						this.updateTrackedExpStatus(
							trackedExp,
							ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
							undefined
						)
						if (this.handleTriggerByFullfilledIds(trackedExp)) {
							// Something was triggered, run again ASAP:
							trackedExp.session.triggerOtherExpectationsAgain = true
						}
					} else {
						const readyToStart = await this.isExpectationReadyToStartWorkingOn(
							trackedExp.session.assignedWorker.worker,
							trackedExp
						)

						const newStatus: Partial<TrackedExpectation['status']> = {}
						if (readyToStart.sourceExists !== undefined) newStatus.sourceExists = readyToStart.sourceExists

						if (readyToStart.ready) {
							this.updateTrackedExpStatus(
								trackedExp,
								ExpectedPackageStatusAPI.WorkStatusState.READY,
								{
									user: 'About to start working..',
									tech: 'About to start working..',
								},
								newStatus
							)
							trackedExp.session.triggerExpectationAgain = true
						} else {
							// Not ready to start
							this.updateTrackedExpStatus(
								trackedExp,
								ExpectedPackageStatusAPI.WorkStatusState.WAITING,
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
						this.getNoAssignedWorkerReason(trackedExp.session)
					)
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.READY) {
				// Start working on it:

				await this.assignWorkerToSession(trackedExp.session, trackedExp)
				if (trackedExp.session.assignedWorker) {
					const assignedWorker = trackedExp.session.assignedWorker

					this.logger.info(`workOnExpectation: "${trackedExp.exp.id}" (${trackedExp.exp.type})`)

					// Start working on the Expectation:
					const wipInfo = await assignedWorker.worker.workOnExpectation(trackedExp.exp, assignedWorker.cost)

					trackedExp.status.workInProgressCancel = async () => {
						await assignedWorker.worker.cancelWorkInProgress(wipInfo.wipId)
						delete trackedExp.status.workInProgressCancel
					}

					// trackedExp.status.workInProgress = new WorkInProgressReceiver(wipInfo.properties)
					this.worksInProgress[`${assignedWorker.id}_${wipInfo.wipId}`] = {
						properties: wipInfo.properties,
						trackedExp: trackedExp,
						worker: assignedWorker.worker,
					}

					this.updateTrackedExpStatus(
						trackedExp,
						ExpectedPackageStatusAPI.WorkStatusState.WORKING,
						undefined,
						wipInfo.properties
					)
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						this.getNoAssignedWorkerReason(trackedExp.session)
					)
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				// It is already working, don't do anything
				// TODO: work-timeout?
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
				// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore?

				if (timeSinceLastEvaluation > this.getFullfilledWaitTime()) {
					await this.assignWorkerToSession(trackedExp.session, trackedExp)
					if (trackedExp.session.assignedWorker) {
						// Check if it is still fulfilled:
						const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFullfilled(
							trackedExp.exp,
							true
						)
						if (fulfilled.fulfilled) {
							// Yes it is still fullfiled
							// No need to update the tracked state, since it's already fullfilled:
							// this.updateTrackedExp(trackedExp, WorkStatusState.FULFILLED, fulfilled.reason)
						} else {
							// It appears like it's not fullfilled anymore
							trackedExp.status.actualVersionHash = undefined
							trackedExp.status.workProgress = undefined
							this.updateTrackedExpStatus(
								trackedExp,
								ExpectedPackageStatusAPI.WorkStatusState.WAITING,
								fulfilled.reason
							)
							trackedExp.session.triggerExpectationAgain = true
						}
					} else {
						// No worker is available at the moment.
						// Do nothing, hopefully some will be available at a later iteration
						this.updateTrackedExpStatus(
							trackedExp,
							undefined,
							this.getNoAssignedWorkerReason(trackedExp.session)
						)
					}
				} else {
					// Do nothing
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.REMOVED) {
				await this.assignWorkerToSession(trackedExp.session, trackedExp)
				if (trackedExp.session.assignedWorker) {
					const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						trackedExp.session.expectationCanBeRemoved = true

						this.callbacks.reportExpectationStatus(trackedExp.id, null, null, {})
					} else {
						this.updateTrackedExpStatus(
							trackedExp,
							ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
							removed.reason
						)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						this.getNoAssignedWorkerReason(trackedExp.session)
					)
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.RESTARTED) {
				await this.assignWorkerToSession(trackedExp.session, trackedExp)
				if (trackedExp.session.assignedWorker) {
					// Start by removing the expectation
					const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						this.updateTrackedExpStatus(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.NEW, {
							user: 'Ready to start (after restart)',
							tech: 'Ready to start (after restart)',
						})
						trackedExp.session.triggerExpectationAgain = true
					} else {
						this.updateTrackedExpStatus(
							trackedExp,
							ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
							removed.reason
						)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						this.getNoAssignedWorkerReason(trackedExp.session)
					)
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.ABORTED) {
				await this.assignWorkerToSession(trackedExp.session, trackedExp)
				if (trackedExp.session.assignedWorker) {
					// Start by removing the expectation
					const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						// This will cause the expectation to be intentionally stuck in the ABORTED state.
						this.updateTrackedExpStatus(trackedExp, ExpectedPackageStatusAPI.WorkStatusState.ABORTED, {
							user: 'Aborted',
							tech: 'Aborted',
						})
					} else {
						this.updateTrackedExpStatus(
							trackedExp,
							ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
							removed.reason
						)
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.updateTrackedExpStatus(
						trackedExp,
						undefined,
						this.getNoAssignedWorkerReason(trackedExp.session)
					)
				}
			} else {
				assertNever(trackedExp.state)
			}
		} catch (err) {
			this.logger.error('Error thrown in evaluateExpectationState')
			this.logger.error(err)
			this.updateTrackedExpStatus(trackedExp, undefined, {
				user: 'Internal error in Package Manager',
				tech: err.toString(),
			})
		}
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
		state: ExpectedPackageStatusAPI.WorkStatusState | undefined,
		reason: Reason | undefined,
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

		if (!_.isEqual(trackedExp.reason, reason)) {
			trackedExp.reason = reason || { user: '', tech: '' }
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
				`${trackedExp.exp.statusReport.label}: New state: "${prevState}"->"${trackedExp.state}", reason: "${trackedExp.reason.tech}"`
			)
		} else if (updatedReason) {
			this.logger.info(
				`${trackedExp.exp.statusReport.label}: State: "${trackedExp.state}", reason: "${trackedExp.reason.tech}"`
			)
		}

		if (updatedState || updatedReason) {
			this.callbacks.reportExpectationStatus(trackedExp.id, trackedExp.exp, null, {
				status: trackedExp.state,
				statusReason: trackedExp.reason,
			})
		}
		if (updatedState || updatedReason || updatedStatus) {
			this.updatePackageContainerPackageStatus(trackedExp)
		}
	}
	private updatePackageContainerPackageStatus(trackedExp: TrackedExpectation) {
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
			for (const fromPackage of trackedExp.exp.fromPackages) {
				// TODO: this is probably not eh right thing to do:
				for (const packageContainer of trackedExp.exp.endRequirement.targets) {
					this.callbacks.reportPackageContainerPackageStatus(packageContainer.containerId, fromPackage.id, {
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
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
			return ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
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
			session.noAssignedWorkerReason = { user: `No workers available`, tech: `No workers available` }
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
								randomCost: Math.random(), // To randomize if there are several with the same best cost
							})
						}
					}
				})
			)
			if (workerCosts.length >= minWorkerCount) break
		}

		workerCosts.sort((a, b) => {
			// Lowest cost first:
			const aCost: number = a.cost.startCost + a.cost.cost
			const bCost: number = b.cost.startCost + b.cost.cost
			if (aCost > bCost) return 1
			if (aCost < bCost) return -1

			// To randomize if there are several with the same best cost:
			if (a.randomCost > b.randomCost) return 1
			if (a.randomCost < b.randomCost) return -1

			return 0
		})

		const bestWorker = workerCosts[0]

		if (bestWorker && bestWorker.cost.startCost < 10) {
			// Only allow starting if the job can start in a short while
			session.assignedWorker = bestWorker
		} else {
			session.noAssignedWorkerReason = {
				user: `Waiting for a free worker (${trackedExp.availableWorkers.length} workers are currently busy)`,
				tech: `Waiting for a free worker (${trackedExp.availableWorkers.length} busy)`,
			}
		}
	}
	/**
	 * To be called when trackedExp.status turns fullfilled.
	 * Triggers any other expectations that listens to the fullfilled one.
	 */
	private handleTriggerByFullfilledIds(trackedExp: TrackedExpectation): boolean {
		let hasTriggeredSomething = false
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
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
				if (this.trackedExpectations[id].state !== ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
					waitingFor = this.trackedExpectations[id]
					break
				}
			}
			if (waitingFor) {
				return {
					ready: false,
					reason: {
						user: `Waiting for "${waitingFor.exp.statusReport.label}"`,
						tech: `Waiting for "${waitingFor.exp.statusReport.label}"`,
					},
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
					monitorIsSetup: false,
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
					const disposeMonitorResult = await workerAgent.api.disposePackageContainerMonitors(
						trackedPackageContainer.packageContainer
					)
					if (!disposeMonitorResult.success) {
						this.updateTrackedPackageContainerStatus(trackedPackageContainer, {
							user: `Unable to remove monitor, due to ${disposeMonitorResult.reason.user}`,
							tech: `Unable to dispose monitor: ${disposeMonitorResult.reason.tech}`,
						})
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
			if (!trackedPackageContainer.currentWorker) {
				// Find a worker that supports this PackageContainer

				let notSupportReason: Reason | null = null
				await Promise.all(
					Object.entries(this.workerAgents).map(async ([workerId, workerAgent]) => {
						const support = await workerAgent.api.doYouSupportPackageContainer(
							trackedPackageContainer.packageContainer
						)
						if (!trackedPackageContainer.currentWorker) {
							if (support.support) {
								trackedPackageContainer.currentWorker = workerId
							} else {
								notSupportReason = support.reason
							}
						}
					})
				)
				if (!trackedPackageContainer.currentWorker) {
					notSupportReason = {
						user: 'Found no worker that supports this packageContainer',
						tech: 'Found no worker that supports this packageContainer',
					}
				}
				if (notSupportReason) {
					this.updateTrackedPackageContainerStatus(trackedPackageContainer, {
						user: `Unable to handle PackageContainer, due to: ${notSupportReason.user}`,
						tech: `Unable to handle PackageContainer, due to: ${notSupportReason.tech}`,
					})
					continue // Break further execution for this PackageContainer
				}
			}

			if (trackedPackageContainer.currentWorker) {
				const workerAgent = this.workerAgents[trackedPackageContainer.currentWorker]

				if (!trackedPackageContainer.monitorIsSetup) {
					const monitorSetup = await workerAgent.api.setupPackageContainerMonitors(
						trackedPackageContainer.packageContainer
					)

					trackedPackageContainer.status.monitors = {}
					if (monitorSetup.success) {
						trackedPackageContainer.monitorIsSetup = true
						for (const [monitorId, monitor] of Object.entries(monitorSetup.monitors)) {
							trackedPackageContainer.status.monitors[monitorId] = {
								label: monitor.label,
								reason: {
									user: 'Starting up',
									tech: 'Starting up',
								},
							}
						}
					} else {
						this.updateTrackedPackageContainerStatus(trackedPackageContainer, {
							user: `Unable to set up monitor for PackageContainer, due to: ${monitorSetup.reason.user}`,
							tech: `Unable to set up monitor for PackageContainer, due to: ${monitorSetup.reason.tech}`,
						})
					}
				}
				const cronJobStatus = await workerAgent.api.runPackageContainerCronJob(
					trackedPackageContainer.packageContainer
				)
				if (!cronJobStatus.success) {
					this.updateTrackedPackageContainerStatus(trackedPackageContainer, {
						user: 'Cron job not completed: ' + cronJobStatus.reason.user,
						tech: 'Cron job not completed: ' + cronJobStatus.reason.tech,
					})
					continue
				}
			}
		}
	}
	private updateTrackedPackageContainerStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		reason: Reason
	) {
		trackedPackageContainer.lastEvaluationTime = Date.now()

		let updatedReason = false

		if (trackedPackageContainer.status.reason !== reason) {
			trackedPackageContainer.status.reason = reason || ''
			updatedReason = true
		}

		if (updatedReason) {
			this.logger.info(
				`PackageContainerStatus "${trackedPackageContainer.packageContainer.label}": Reason: "${trackedPackageContainer.status.reason.tech}"`
			)
		}

		if (updatedReason) {
			this.callbacks.reportPackageContainerExpectationStatus(
				trackedPackageContainer.id,
				trackedPackageContainer.packageContainer,
				{
					statusReason: trackedPackageContainer.status.reason,
				}
			)
		}
	}
	private getNoAssignedWorkerReason(session: ExpectationStateHandlerSession): ExpectedPackageStatusAPI.Reason {
		if (!session.noAssignedWorkerReason) {
			this.logger.error(
				`trackedExp.session.noAssignedWorkerReason is undefined, although assignedWorker was set..`
			)
			return {
				user: 'Unknown reason (internal error)',
				tech: 'Unknown reason',
			}
		}
		return session.noAssignedWorkerReason
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

interface TrackedExpectation {
	/** Unique ID of the tracked expectation */
	id: string
	/** The Expectation */
	exp: Expectation.Any

	/** The current State of the expectation. */
	state: ExpectedPackageStatusAPI.WorkStatusState
	/** Reason for the current state. */
	reason: Reason

	/** List of worker ids that supports this Expectation */
	availableWorkers: string[]
	/** Timestamp of the last time the expectation was evaluated. */
	lastEvaluationTime: number
	/** The number of times the expectation has failed */
	errorCount: number

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
	/** A storage which is persistant only for a short while, during an evaluation of the Expectation. */
	session: ExpectationStateHandlerSession | null
}
/** Contains some data which is persisted during an evaluation-session */
interface ExpectationStateHandlerSession {
	/** Set to true if the tracked expectation should be triggered again ASAP */
	triggerExpectationAgain?: boolean
	/** Set to true if the other tracked expectations should be triggered again ASAP */
	triggerOtherExpectationsAgain?: boolean
	/** Set to true when the tracked expectation can safely be removed */
	expectationCanBeRemoved?: boolean

	/** If there was an unexpected error */
	hadError?: boolean

	/** The Worker assigned to the Expectation during this evaluation-session */
	assignedWorker?: WorkerAgentAssignment
	noAssignedWorkerReason?: Reason
}
interface WorkerAgentAssignment {
	worker: WorkerAgentAPI
	id: string
	cost: ExpectationManagerWorkerAgent.ExpectationCost
	randomCost: number
}
export type MessageFromWorker = (message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any) => Promise<any>

export interface ExpectationManagerCallbacks {
	reportExpectationStatus: (
		expectationId: string,
		expectaction: Expectation.Any | null,
		actualVersionHash: string | null,
		statusInfo: {
			status?: ExpectedPackageStatusAPI.WorkStatusState
			progress?: number
			statusReason?: Reason
		}
	) => void
	reportPackageContainerPackageStatus: (
		containerId: string,
		packageId: string,
		packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
	) => void
	reportPackageContainerExpectationStatus: (
		containerId: string,
		packageContainer: PackageContainerExpectation | null,
		statusInfo: {
			statusReason?: Reason
		}
	) => void
	messageFromWorker: MessageFromWorker
}

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

	/** If the monitor is set up okay */
	monitorIsSetup: boolean

	/** These statuses are sent from the workers */
	status: {
		/** Reason for the status (used in GUIs) */
		reason?: Reason
		monitors: {
			[monitorId: string]: {
				label: string
				reason: Reason
			}
		}
	}
}
function assertNever(_shouldBeNever: never) {
	// Nothing
}
