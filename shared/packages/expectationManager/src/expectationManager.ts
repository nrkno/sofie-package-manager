import _ from 'underscore'
import {
	StatusCode,
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
	assertNever,
	ExpectationManagerStatusReport,
	LogLevel,
	deepEqual,
	stringifyError,
	diff,
	HelpfulEventEmitter,
	Statuses,
	hashObj,
	setLogLevel,
} from '@shared/api'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { WorkforceAPI } from './workforceApi'
import { WorkerAgentAPI } from './workerAgentApi'
import PromisePool from '@supercharge/promise-pool'
import { ExpectationManagerConstants, getDefaultConstants } from './lib/constants'
import { ExpectationStateHandlerSession, TrackedExpectation, WorkerAgentAssignment } from './lib/types'
import { getDefaultTrackedExpectation, sortTrackedExpectations } from './lib/expectations'

/**
 * The Expectation Manager is responsible for tracking the state of the Expectations,
 * and communicate with the Workers to progress them.
 * @see FOR_DEVELOPERS.md
 */

export class ExpectationManager extends HelpfulEventEmitter {
	private constants: ExpectationManagerConstants
	private enableChaosMonkey = false

	private workforceAPI: WorkforceAPI

	/** Store for various incoming data, to be processed on next iteration round */
	private receivedUpdates: {
		/** Store for incoming Expectations */
		expectations: { [id: string]: Expectation.Any }
		/** Set to true when there have been changes to expectations.receivedUpdates */
		expectationsHasBeenUpdated: boolean

		/** Store for incoming Restart-calls */
		restartExpectations: { [id: string]: true }
		/** Store for incoming Abort-calls */
		abortExpectations: { [id: string]: true }
		/** Store for incoming RestartAll-calls */
		restartAllExpectations: boolean

		/** Store for incoming PackageContainerExpectations */
		packageContainers: { [id: string]: PackageContainerExpectation }
		/** Set to true when there have been changes to expectations.receivedUpdates */
		packageContainersHasBeenUpdated: boolean

		/** Store for incoming restart-container calls */
		restartPackageContainers: { [containerId: string]: true }
	} = {
		expectations: {},
		expectationsHasBeenUpdated: false,
		packageContainers: {},
		packageContainersHasBeenUpdated: false,
		restartExpectations: {},
		abortExpectations: {},
		restartPackageContainers: {},
		restartAllExpectations: false,
	}

	/** This is the main store of all Tracked Expectations */
	private trackedExpectations: { [id: string]: TrackedExpectation } = {}
	private trackedExpectationsCount = 0

	private trackedPackageContainers: { [id: string]: TrackedPackageContainerExpectation } = {}
	/** key-value store of which expectations are triggered when another is fullfilled */
	private _triggerByFullfilledIds: { [fullfilledId: string]: string[] } = {}

	private waitingExpectations: TrackedExpectation[] = []

	private _evaluateExpectationsTimeout: NodeJS.Timeout | undefined = undefined
	private _evaluateExpectationsIsBusy = false
	private _evaluateExpectationsRunAsap = false

	private websocketServer?: WebsocketServer

	private workerAgents: {
		[workerId: string]: TrackedWorkerAgent
	} = {}
	private worksInProgress: {
		[id: string]: {
			wipId: number
			properties: ExpectationManagerWorkerAgent.WorkInProgressProperties
			trackedExp: TrackedExpectation
			workerId: string
			worker: WorkerAgentAPI
			cost: number
			startCost: number
			lastUpdated: number
		}
	} = {}
	private terminated = false

	private statusReport: ExpectationManagerStatusReport
	private serverAccessUrl = ''
	private initWorkForceAPIPromise?: { resolve: () => void; reject: (reason?: any) => void }
	private statuses: Statuses = {}
	private emittedStatusHash = ''
	private statusMonitorInterval: NodeJS.Timeout | null = null
	/** Timestamp, used to determine how long the work-queue has been stuck */
	private monitorStatusWaiting: number | null = null

	private logger: LoggerInstance
	constructor(
		logger: LoggerInstance,
		public readonly managerId: string,
		private serverOptions: ExpectationManagerServerOptions,
		/** At what url the ExpectationManager can be reached on */
		private serverAccessBaseUrl: string | undefined,
		private workForceConnectionOptions: ClientConnectionOptions,
		private callbacks: ExpectationManagerCallbacks,
		options?: ExpectationManagerOptions
	) {
		super()
		this.logger = logger.category('ExpectationManager')
		this.constants = {
			...getDefaultConstants(),
			...options?.constants,
		}
		this.enableChaosMonkey = options?.chaosMonkey ?? false
		this.workforceAPI = new WorkforceAPI(this.logger)
		this.workforceAPI.on('disconnected', () => {
			this.logger.warn('ExpectationManager: Workforce disconnected')
			this._updateStatus('workforce', {
				statusCode: StatusCode.BAD,
				message: 'Workforce disconnected (Restart Package Manager if this persists)',
			})
		})
		this.workforceAPI.on('connected', () => {
			this.logger.info('ExpectationManager: Workforce connected')
			this._updateStatus('workforce', { statusCode: StatusCode.GOOD, message: '' })

			this.workforceAPI
				.registerExpectationManager(this.managerId, this.serverAccessUrl)
				.then(() => {
					this.initWorkForceAPIPromise?.resolve() // To finish the init() function
				})
				.catch((err) => {
					this.logger.error(`ExpectationManager: Error in registerExpectationManager: ${stringifyError(err)}`)
					this.initWorkForceAPIPromise?.reject(err)
				})
		})
		this.workforceAPI.on('error', (err) => {
			this.logger.error(`ExpectationManager: Workforce error event: ${stringifyError(err)}`)
		})

		this.statusReport = this.updateStatusReport()
		if (this.serverOptions.type === 'websocket') {
			this.websocketServer = new WebsocketServer(
				this.serverOptions.port,
				this.logger,
				(client: ClientConnection) => {
					// A new client has connected

					this.logger.info(`ExpectationManager: New ${client.clientType} connected, id "${client.clientId}"`)

					switch (client.clientType) {
						case 'workerAgent': {
							const expectationManagerMethods = this.getWorkerAgentAPI(client.clientId)

							const api = new WorkerAgentAPI(expectationManagerMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							this.workerAgents[client.clientId] = { api, connected: true }
							client.once('close', () => {
								this.logger.warn(`ExpectationManager: Connection to Worker "${client.clientId}" closed`)

								this.workerAgents[client.clientId].connected = false
								delete this.workerAgents[client.clientId]
							})
							this.logger.info(
								`ExpectationManager: Connection to Worker "${client.clientId}" established`
							)
							this._triggerEvaluateExpectations(true)
							break
						}
						case 'N/A':
						case 'expectationManager':
						case 'appContainer':
							throw new Error(`ExpectationManager: Unsupported clientType "${client.clientType}"`)
						default: {
							assertNever(client.clientType)
							throw new Error(`ExpectationManager: Unknown clientType "${client.clientType}"`)
						}
					}
				}
			)

			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`Expectationmanager: WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`Expectationmanager: WebsocketServer closed`)
				this._updateStatus('expectationManager.server', {
					statusCode: StatusCode.FATAL,
					message: 'ExpectationManager server closed (Restart Package Manager)',
				})
			})
			this.logger.info(`Expectation Manager running on port ${this.websocketServer.port}`)
		} else {
			// todo: handle direct connections
		}

		this.statusMonitorInterval = setInterval(() => {
			this._monitorStatus()
		}, 60 * 1000)
	}

	/** Initialize the ExpectationManager. This method is should be called shortly after the class has been instantiated. */
	async init(): Promise<void> {
		this.serverAccessUrl = ''
		if (this.workForceConnectionOptions.type === 'internal') {
			this.serverAccessUrl = '__internal'
		} else {
			this.serverAccessUrl = this.serverAccessBaseUrl || 'ws://127.0.0.1'
			if (this.serverOptions.type === 'websocket' && this.serverOptions.port === 0) {
				// When the configured port i 0, the next free port is picked
				this.serverAccessUrl += `:${this.websocketServer?.port}`
			}
		}
		if (!this.serverAccessUrl) throw new Error(`ExpectationManager.serverAccessUrl not set!`)

		await this.workforceAPI.init(this.managerId, this.workForceConnectionOptions, this)

		this._triggerEvaluateExpectations(true)

		// Wait for the this.workforceAPI to be ready before continuing:
		await new Promise<void>((resolve, reject) => {
			this.initWorkForceAPIPromise = { resolve, reject }
		})
		if (this.enableChaosMonkey) {
			// Chaos-monkey, make the various processes cut their connections, to ensure that the reconnection works:
			setInterval(() => {
				this.logger.info('Chaos Monkey says: "KILLING CONNNECTIONS" ==========')
				this.sendDebugKillConnections().catch(this.logger.error)
			}, 30 * 1000)
		}

		this.logger.info(`ExpectationManager: Initialized"`)
	}
	/** Used to hook into methods of Workforce directly (this is done when the server and client runs in the same process). */
	hookToWorkforce(
		hook: Hook<WorkForceExpectationManager.WorkForce, WorkForceExpectationManager.ExpectationManager>
	): void {
		this.workforceAPI.hook(hook)
	}
	terminate(): void {
		this.terminated = true
		if (this.websocketServer) {
			this.websocketServer.terminate()
		}
		if (this._evaluateExpectationsTimeout) {
			clearTimeout(this._evaluateExpectationsTimeout)
			this._evaluateExpectationsTimeout = undefined
		}
		if (this.statusMonitorInterval) {
			clearInterval(this.statusMonitorInterval)
			this.statusMonitorInterval = null
		}
	}
	/** USED IN TESTS ONLY. Quickly reset the tracked work of the expectationManager. */
	resetWork(): void {
		this.receivedUpdates = {
			expectations: {},
			expectationsHasBeenUpdated: false,
			packageContainers: {},
			packageContainersHasBeenUpdated: false,
			restartExpectations: {},
			abortExpectations: {},
			restartPackageContainers: {},
			restartAllExpectations: false,
		}
		this.trackedExpectations = {}
		this.trackedExpectationsCount = 0
		this.trackedPackageContainers = {}
		// this.worksInProgress

		this._triggerEvaluateExpectations(true)
	}
	/** USED IN TESTS ONLY. Send out a message to all connected processes that they are to cut their connections. This is to test resilience. */
	async sendDebugKillConnections(): Promise<void> {
		await this.workforceAPI._debugSendKillConnections()
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
			this.workerAgents[clientId] = { api, connected: true }

			return workerAgentMethods
		}
	}
	removeWorkerAgentHook(clientId: string): void {
		const workerAgent = this.workerAgents[clientId]
		if (!workerAgent) throw new Error(`WorkerAgent "${clientId}" not found!`)

		if (workerAgent.api.type !== 'internal')
			throw new Error(`Cannot remove WorkerAgent "${clientId}", due to the type being "${workerAgent.api.type}"`)

		workerAgent.connected = false
		delete this.workerAgents[clientId]
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
	restartPackageContainer(containerId: string): void {
		this.receivedUpdates.restartPackageContainers[containerId] = true
		this.receivedUpdates.packageContainersHasBeenUpdated = true
		this._triggerEvaluateExpectations(true)
	}
	/** Called by Workforce */
	async setLogLevel(logLevel: LogLevel): Promise<void> {
		setLogLevel(logLevel)
	}
	/** Called by Workforce*/
	async _debugKill(): Promise<void> {
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}
	/** FOR DEBUGGING ONLY. Cut websocket connections, in order to ensure that they are restarted */
	async _debugSendKillConnections(): Promise<void> {
		this.workforceAPI.debugCutConnection()
		// note: workers cut their own connections
	}
	async onWorkForceStatus(statuses: Statuses): Promise<void> {
		for (const [id, status] of Object.entries(statuses)) {
			this._updateStatus(`workforce-${id}`, status)
		}
	}
	async getStatusReport(): Promise<any> {
		return {
			workforce: this.workforceAPI.connected ? await this.workforceAPI.getStatusReport() : {},
			expectationManager: this.statusReport,
		}
	}
	async setLogLevelOfApp(appId: string, logLevel: LogLevel): Promise<void> {
		return this.workforceAPI.setLogLevelOfApp(appId, logLevel)
	}
	async debugKillApp(appId: string): Promise<void> {
		return this.workforceAPI._debugKillApp(appId)
	}
	getTroubleshootData(): any {
		return {
			trackedExpectations: this.getTrackedExpectations(),
			workers: this.workerAgents,
		}
	}
	/**
	 * Schedule the evaluateExpectations() to run
	 * @param asap If true, will re-schedule evaluateExpectations() to run as soon as possible
	 */
	private _triggerEvaluateExpectations(asap?: boolean): void {
		if (this.terminated) return

		if (asap) this._evaluateExpectationsRunAsap = true
		if (this._evaluateExpectationsIsBusy) return

		if (this._evaluateExpectationsTimeout) {
			clearTimeout(this._evaluateExpectationsTimeout)
			this._evaluateExpectationsTimeout = undefined
		}

		this._evaluateExpectationsTimeout = setTimeout(
			() => {
				if (this.terminated) return

				this._evaluateExpectationsRunAsap = false
				this._evaluateExpectationsIsBusy = true
				this._evaluateExpectations()
					.then(() => {
						this._evaluateExpectationsIsBusy = false
						this._triggerEvaluateExpectations()
					})
					.catch((err) => {
						this.logger.error(`Error in ExpectationManager._evaluateExpectations: ${stringifyError(err)}`)

						this._evaluateExpectationsIsBusy = false
						this._triggerEvaluateExpectations()
					})
			},
			this._evaluateExpectationsRunAsap ? 1 : this.constants.EVALUATE_INTERVAL
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
					wip.lastUpdated = Date.now()
					if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						this.updateTrackedExpStatus(wip.trackedExp, {
							status: {
								actualVersionHash: actualVersionHash,
								workProgress: progress,
							},
						})
						this.logger.debug(`Expectation "${expLabel(wip.trackedExp)}" progress: ${progress}`)
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
					wip.lastUpdated = Date.now()
					if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						wip.trackedExp.status.actualVersionHash = actualVersionHash
						wip.trackedExp.status.workProgress = 1
						this.updateTrackedExpStatus(wip.trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
							reason,
							status: {
								workProgress: 1,
							},
						})

						if (this.handleTriggerByFullfilledIds(wip.trackedExp)) {
							// Something was triggered, run again asap.
							// We should reevaluate asap, so that any other expectation which might be waiting on this work could start.
							this._triggerEvaluateExpectations(true)
						}
					} else {
						// ignore
					}
					delete this.worksInProgress[`${clientId}_${wipId}`]
				}
			},
			wipEventError: async (wipId: number, reason: Reason): Promise<void> => {
				const wip = this.worksInProgress[`${clientId}_${wipId}`]
				if (wip) {
					wip.lastUpdated = Date.now()
					if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						wip.trackedExp.errorCount++
						this.updateTrackedExpStatus(wip.trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
							reason,
							isError: true,
						})
					} else {
						// ignore
					}
					delete this.worksInProgress[`${clientId}_${wipId}`]
				}
			},
			monitorStatus: async (
				packageContainerId: string,
				monitorId: string,
				status: StatusCode,
				reason: Reason
			) => {
				const trackedPackageContainer = this.trackedPackageContainers[packageContainerId]
				if (!trackedPackageContainer) {
					this.logger.error(`Worker reported status on unknown packageContainer "${packageContainerId}"`)
					return
				}
				trackedPackageContainer.status.statusChanged = Date.now()

				this.updateTrackedPackageContainerMonitorStatus(
					trackedPackageContainer,
					monitorId,
					undefined,
					status,
					reason
				)
			},
		}
	}
	/**
	 * This is the main work-loop of the ExpectationManager.
	 * Evaluates the Expectations and PackageContainerExpectations
	 */
	private async _evaluateExpectations(): Promise<void> {
		this.logger.verbose(Date.now() / 1000 + ' _evaluateExpectations ----------')

		let startTime = Date.now()
		const times: { [key: string]: number } = {}

		// First we're going to see if there is any new incoming data which needs to be pulled in.
		if (this.receivedUpdates.expectationsHasBeenUpdated) {
			await this.updateReceivedExpectations()
		}
		times['timeUpdateReceivedExpectations'] = Date.now() - startTime
		startTime = Date.now()

		if (this.receivedUpdates.packageContainersHasBeenUpdated) {
			await this._updateReceivedPackageContainerExpectations()
		}
		times['timeUpdateReceivedPackageContainerExpectations'] = Date.now() - startTime
		startTime = Date.now()

		// Update the count:
		this.trackedExpectationsCount = Object.keys(this.trackedExpectations).length

		// Iterate through the PackageContainerExpectations:
		await this._evaluateAllTrackedPackageContainers()
		times['timeEvaluateAllTrackedPackageContainers'] = Date.now() - startTime
		startTime = Date.now()

		this.monitorWorksInProgress()
		times['timeMonitorWorksInProgress'] = Date.now() - startTime

		// Iterate through all Expectations:
		const { runAgainASAP, times: evaluateTimes } = await this._evaluateAllExpectations()

		for (const key in evaluateTimes) {
			times[key] = evaluateTimes[key]
		}

		this.statusReport = this.updateStatusReport(times)

		await this.checkIfNeedToScaleUp().catch((err) => {
			this.logger.error(`Error in checkIfNeedToScaleUp: ${stringifyError(err)}`)
		})

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

			let difference: null | 'new' | 'major' | 'minor' = null
			const existingtrackedExp: TrackedExpectation | undefined = this.trackedExpectations[id]
			if (!existingtrackedExp) {
				// new
				difference = 'new'
			} else {
				const isSignificantlyDifferent = !_.isEqual(
					_.omit(existingtrackedExp.exp, 'priority'),
					_.omit(exp, 'priority')
				)
				const isPriorityDifferent = existingtrackedExp.exp.priority !== exp.priority

				if (isSignificantlyDifferent) {
					const trackedExp = existingtrackedExp

					if (trackedExp.state == ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
						if (trackedExp.status.workInProgressCancel) {
							this.logger.debug(`Cancelling ${expLabel(trackedExp)} due to update`)
							await trackedExp.status.workInProgressCancel()
						}
					}
					difference = 'major'
				} else if (isPriorityDifferent) {
					difference = 'minor'
				}
			}

			if (difference === 'new' || difference === 'major') {
				const newTrackedExp = getDefaultTrackedExpectation(exp, existingtrackedExp)

				this.trackedExpectations[id] = newTrackedExp
				if (difference === 'new') {
					this.updateTrackedExpStatus(newTrackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: {
							user: `Added just now`,
							tech: `Added ${Date.now()}`,
						},
						// Don't update the package status, since we don't know anything about the package yet.
						dontUpdatePackage: true,
					})
				} else {
					this.updateTrackedExpStatus(newTrackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason: {
							user: `Updated just now`,
							tech: `Updated ${Date.now()}, diff: (${diff(existingtrackedExp.exp, exp)})`,
						},
						// Don't update the package status, since the package likely hasn't changed:
						dontUpdatePackage: true,
					})
				}
			} else if (difference === 'minor') {
				// A minor update doesn't require a full re-evaluation of the expectation.

				const trackedExp = this.trackedExpectations[id]
				if (trackedExp) {
					this.logger.debug(
						`Minor update of expectation "${expLabel(trackedExp)}": ${diff(existingtrackedExp.exp, exp)}`
					)

					trackedExp.exp = exp
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
						this.logger.verbose(`Cancelling ${expLabel(trackedExp)} due to removed`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				this.updateTrackedExpStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
					reason: {
						user: 'Expectation was removed',
						tech: `Expectation was removed`,
					},
				})
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
						this.logger.verbose(`Cancelling ${expLabel(trackedExp)} due to restart`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				this.updateTrackedExpStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
					reason: {
						user: 'Restarted by user',
						tech: `Restarted by user`,
					},
					// Don't update the package status, since the package likely hasn't changed:
					dontUpdatePackage: true,
				})
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
						this.logger.verbose(`Cancelling ${expLabel(trackedExp)} due to abort`)
						await trackedExp.status.workInProgressCancel()
					}
				}

				this.updateTrackedExpStatus(trackedExp, {
					state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
					reason: {
						user: 'Aborted by user',
						tech: `Aborted by user`,
					},
					// Don't update the package status, since the package likely hasn't changed:
					dontUpdatePackage: true,
				})
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
		return sortTrackedExpectations(this.trackedExpectations, this.constants)
	}

	/** Iterate through the tracked Expectations */
	private async _evaluateAllExpectations(): Promise<{ runAgainASAP: boolean; times: { [key: string]: number } }> {
		/** If this is set to true, we want _evaluateExpectations() to be run again ASAP */
		let runAgainASAP = false

		const times: { [key: string]: number } = {}

		const removeIds: string[] = []

		const tracked = this.getTrackedExpectations()

		// Step 0: Reset the session:
		for (const trackedExp of tracked) {
			trackedExp.session = null
		}

		const postProcessSession = (trackedExp: TrackedExpectation) => {
			if (trackedExp.session?.triggerOtherExpectationsAgain) {
				// Will cause another iteration of this._handleExpectations to be called again ASAP after this iteration has finished
				runAgainASAP = true
			}
			if (trackedExp.session?.expectationCanBeRemoved) {
				// The tracked expectation can be removed
				removeIds.push(trackedExp.id)
			}
		}

		/** These states can be handled in parallel */
		const handleStatesParallel = [
			// Note: The order of these is important, as the states normally progress in this order:
			ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
			ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
			ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
			ExpectedPackageStatusAPI.WorkStatusState.NEW,
			ExpectedPackageStatusAPI.WorkStatusState.WAITING,
			ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
		]

		/** These states must be handled one at a time */
		const handleStatesSerial = [
			ExpectedPackageStatusAPI.WorkStatusState.READY,
			ExpectedPackageStatusAPI.WorkStatusState.WORKING,
		]

		// Step 1: Evaluate the Expectations which are in the states that can be handled in parallel:
		for (const handleState of handleStatesParallel) {
			const startTime = Date.now()
			// Filter out the ones that are in the state we're about to handle:
			const trackedWithState = tracked.filter((trackedExp) => trackedExp.state === handleState)

			if (trackedWithState.length) {
				this.logger.verbose(`Handle state ${handleState}, ${trackedWithState.length} expectations..`)
			}

			if (trackedWithState.length) {
				// We're using a PromisePool so that we don't send out an unlimited number of parallel requests to the workers.
				const CONCURRENCY = 50
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
						postProcessSession(trackedExp)
					})
			}
			times[`time_${handleState}`] = Date.now() - startTime
		}

		// Step 1.5: Reset the session:
		// Because during the next iteration, the worker-assignment need to be done in series
		for (const trackedExp of tracked) {
			trackedExp.session = null
		}

		this.logger.verbose(`Handle other states..`)
		handleStatesSerial.forEach((handleState) => {
			const trackedWithState = tracked.filter((trackedExp) => trackedExp.state === handleState)
			this.logger.verbose(`Handle state ${handleState}, ${trackedWithState.length} expectations..`)
		})
		this.logger.verbose(`Worker count: ${Object.keys(this.workerAgents).length}`)

		const startTime = Date.now()
		// Step 2: Evaluate the expectations, now one by one:
		for (const trackedExp of tracked) {
			// Only handle the states that
			if (handleStatesSerial.includes(trackedExp.state)) {
				// Evaluate the Expectation:
				await this.evaluateExpectationState(trackedExp)
				postProcessSession(trackedExp)
			}

			if (runAgainASAP && Date.now() - startTime > this.constants.ALLOW_SKIPPING_QUEUE_TIME) {
				// Skip the rest of the queue, so that we don't get stuck on evaluating low-prio expectations.
				this.logger.verbose(
					`Skipping the rest of the queue (after ${this.constants.ALLOW_SKIPPING_QUEUE_TIME})`
				)
				break
			}
			if (this.receivedUpdates.expectationsHasBeenUpdated) {
				// We have received new expectations. We should abort the evaluation-loop and restart from the beginning.
				// So that we don't miss any high-prio Expectations.
				this.logger.verbose(`Skipping the rest of the queue, due to expectations has been updated`)
				runAgainASAP = true
				break
			}
		}
		times[`time_restTrackedExp`] = Date.now() - startTime
		for (const id of removeIds) {
			delete this.trackedExpectations[id]
		}

		return { runAgainASAP, times }
	}
	/** Evaluate the state of an Expectation */
	private async evaluateExpectationState(trackedExp: TrackedExpectation): Promise<void> {
		const timeSinceLastEvaluation = Date.now() - trackedExp.lastEvaluationTime
		if (!trackedExp.session) trackedExp.session = {}
		if (trackedExp.session.hadError) return // There was an error during the session.

		if (trackedExp.session.expectationCanBeRemoved) return // The expectation has been removed

		try {
			if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW) {
				// Check which workers might want to handle it:
				// Reset properties:
				trackedExp.status = {}

				let hasQueriedAnyone = false
				await Promise.all(
					Object.entries(this.workerAgents).map(async ([workerId, workerAgent]) => {
						if (!workerAgent.connected) return

						// Only ask each worker once:
						if (
							!trackedExp.queriedWorkers[workerId] ||
							Date.now() - trackedExp.queriedWorkers[workerId] > this.constants.WORKER_SUPPORT_TIME
						) {
							trackedExp.queriedWorkers[workerId] = Date.now()
							hasQueriedAnyone = true
							try {
								const support = await workerAgent.api.doYouSupportExpectation(trackedExp.exp)

								if (support.support) {
									trackedExp.availableWorkers[workerId] = true
								} else {
									delete trackedExp.availableWorkers[workerId]
									trackedExp.noAvailableWorkersReason = support.reason
								}
							} catch (err) {
								delete trackedExp.availableWorkers[workerId]

								if ((err + '').match(/timeout/i)) {
									trackedExp.noAvailableWorkersReason = {
										user: 'Worker timed out',
										tech: `Worker "${workerId} timeout"`,
									}
								} else throw err
							}
						}
					})
				)
				const availableWorkersCount = Object.keys(trackedExp.availableWorkers).length
				if (availableWorkersCount) {
					if (hasQueriedAnyone) {
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
							reason: {
								user: `${availableWorkersCount} workers available, about to start...`,
								tech: `Found ${availableWorkersCount} workers who supports this Expectation`,
							},
							// Don't update the package status, since we don't know anything about the package yet:
							dontUpdatePackage: true,
						})
					} else {
						// If we didn't query anyone, just skip ahead to next state without being too verbose:
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
							// Don't update the package status, since we don't know anything about the package yet:
							dontUpdatePackage: true,
						})
					}
				} else {
					if (!Object.keys(trackedExp.queriedWorkers).length) {
						if (!Object.keys(this.workerAgents).length) {
							this.updateTrackedExpStatus(trackedExp, {
								state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
								reason: {
									user: `No Workers available (this is likely a configuration issue)`,
									tech: `No Workers available`,
								},
								// Don't update the package status, since we don't know anything about the package yet:
								dontUpdatePackage: true,
							})
						} else {
							this.updateTrackedExpStatus(trackedExp, {
								state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
								reason: {
									user: `No Workers available (this is likely a configuration issue)`,
									tech: `No Workers queried, ${Object.keys(this.workerAgents).length} available`,
								},
								// Don't update the package status, since we don't know anything about the package yet:
								dontUpdatePackage: true,
							})
						}
					} else {
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
							reason: {
								user: `Found no workers who supports this Expectation, due to: ${trackedExp.noAvailableWorkersReason.user}`,
								tech: `Found no workers who supports this Expectation: "${
									trackedExp.noAvailableWorkersReason.tech
								}", have asked workers: [${Object.keys(trackedExp.queriedWorkers).join(',')}]`,
							},
							// Don't update the package status, since we don't know anything about the package yet:
							dontUpdatePackage: true,
						})
					}
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
				// Check if the expectation is ready to start:

				await this.assignWorkerToSession(trackedExp)

				if (trackedExp.session.assignedWorker) {
					try {
						// First, check if it is already fulfilled:
						const fulfilled = await trackedExp.session.assignedWorker.worker.isExpectationFullfilled(
							trackedExp.exp,
							false
						)
						if (fulfilled.fulfilled) {
							// The expectation is already fulfilled:
							this.updateTrackedExpStatus(trackedExp, {
								state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
							})
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
							if (readyToStart.sourceExists !== undefined)
								newStatus.sourceExists = readyToStart.sourceExists

							if (readyToStart.ready) {
								this.updateTrackedExpStatus(trackedExp, {
									state: ExpectedPackageStatusAPI.WorkStatusState.READY,
									reason: {
										user: 'About to start working..',
										tech: `About to start, was not fulfilled: ${fulfilled.reason.tech}`,
									},
									status: newStatus,
								})
							} else {
								// Not ready to start
								this.updateTrackedExpStatus(trackedExp, {
									state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
									reason: readyToStart.reason,
									status: newStatus,
									isError: !readyToStart.isWaitingForAnother,
								})
							}
						}
					} catch (error) {
						// There was an error, clearly it's not ready to start
						this.logger.warn(`Error in WAITING: ${stringifyError(error)}`)

						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
							reason: {
								user: 'Restarting due to error',
								tech: `Error from worker ${trackedExp.session.assignedWorker.id}: "${stringifyError(
									error
								)}"`,
							},
							isError: true,
						})
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.noWorkerAssigned(trackedExp)
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.READY) {
				// Start working on it:

				await this.assignWorkerToSession(trackedExp)

				if (
					trackedExp.session.assignedWorker &&
					// Only allow starting if the job can start in a short while:
					trackedExp.session.assignedWorker.cost.startCost > 0 // 2022-03-25: We're setting this to 0 to only allow one job per worker
				) {
					trackedExp.session.noAssignedWorkerReason = {
						user: `Workers are busy`,
						tech: `Workers are busy (startCost=${trackedExp.session.assignedWorker.cost.startCost})`,
					}
					delete trackedExp.session.assignedWorker
				}
				if (trackedExp.session.assignedWorker) {
					const assignedWorker = trackedExp.session.assignedWorker

					try {
						this.logger.debug(`workOnExpectation: "${expLabel(trackedExp)}" (${trackedExp.exp.type})`)

						// Start working on the Expectation:
						const wipInfo = await assignedWorker.worker.workOnExpectation(
							trackedExp.exp,
							assignedWorker.cost,
							this.constants.WORK_TIMEOUT_TIME
						)

						trackedExp.status.workInProgressCancel = async () => {
							await assignedWorker.worker.cancelWorkInProgress(wipInfo.wipId)
							delete trackedExp.status.workInProgressCancel
						}

						// trackedExp.status.workInProgress = new WorkInProgressReceiver(wipInfo.properties)
						this.worksInProgress[`${assignedWorker.id}_${wipInfo.wipId}`] = {
							wipId: wipInfo.wipId,
							properties: wipInfo.properties,
							trackedExp: trackedExp,
							workerId: assignedWorker.id,
							worker: assignedWorker.worker,
							cost: assignedWorker.cost.cost,
							startCost: assignedWorker.cost.startCost,
							lastUpdated: Date.now(),
						}

						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.WORKING,
							reason: {
								user: `Working on: ${wipInfo.properties.workLabel}`,
								tech: `Working on: ${wipInfo.properties.workLabel}`,
							},
							status: wipInfo.properties,
						})
					} catch (error) {
						this.logger.warn(`Error in READY: ${stringifyError(error)}`)
						// There was an error
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
							reason: {
								user: 'Restarting due to an error',
								tech: `Error from worker ${trackedExp.session.assignedWorker.id}: "${stringifyError(
									error
								)}"`,
							},
							isError: true,
						})
					}
				} else {
					// No worker is available at the moment.
					// Check if anough time has passed if it makes sense to check for new workers again:

					if (
						trackedExp.noWorkerAssignedTime &&
						Date.now() - trackedExp.noWorkerAssignedTime > this.constants.WORKER_SUPPORT_TIME
					) {
						// Restart
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
							// Don't update the package status, since we don't know anything about the package at this point:
							dontUpdatePackage: true,
						})
					} else {
						// Do nothing, hopefully some will be available at a later iteration
						this.noWorkerAssigned(trackedExp)
					}
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				// It is already working, don't do anything
				// TODO: work-timeout?
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
				// TODO: Some monitor that is able to invalidate if it isn't fullfilled anymore?

				if (timeSinceLastEvaluation > this.getFullfilledWaitTime()) {
					await this.assignWorkerToSession(trackedExp)
					if (trackedExp.session.assignedWorker) {
						try {
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
								this.updateTrackedExpStatus(trackedExp, {
									state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
									reason: fulfilled.reason,
								})
							}
						} catch (error) {
							this.logger.warn(`Error in FULFILLED: ${stringifyError(error)}`)
							// Do nothing, hopefully some will be available at a later iteration
							// todo: Is this the right thing to do?
							this.updateTrackedExpStatus(trackedExp, {
								reason: {
									user: `Can't check if fulfilled, due to an error`,
									tech: `Error from worker ${trackedExp.session.assignedWorker.id}: ${stringifyError(
										error
									)}`,
								},
								// Should we se this here?
								// dontUpdatePackage: true,
							})
						}
					} else {
						// No worker is available at the moment.
						// Do nothing, hopefully some will be available at a later iteration
						this.noWorkerAssigned(trackedExp)
					}
				} else {
					// Do nothing
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.REMOVED) {
				await this.assignWorkerToSession(trackedExp)
				/** When true, the expectation can be removed */
				let removeTheExpectation = false
				if (trackedExp.session.assignedWorker) {
					const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					// Check if the removal was successful:
					if (removed.removed) {
						removeTheExpectation = true
					} else {
						// Something went wrong when trying to handle the removal.
						trackedExp.errorOnRemoveCount++
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.REMOVED,
							reason: removed.reason,
							isError: true,
						})
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					trackedExp.errorOnRemoveCount++
					this.noWorkerAssigned(trackedExp)
				}

				// We only allow a number of failure-of-removals.
				// After that, we'll remove the expectation to avoid congestion:
				if (trackedExp.errorOnRemoveCount > this.constants.FAILED_REMOVE_COUNT) {
					removeTheExpectation = true
				}
				if (removeTheExpectation) {
					trackedExp.session.expectationCanBeRemoved = true
					// Send a status that this expectation has been removed:
					this.updatePackageContainerPackageStatus(trackedExp, true)
					this.callbacks.reportExpectationStatus(trackedExp.id, null, null, {})
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.RESTARTED) {
				await this.assignWorkerToSession(trackedExp)
				if (trackedExp.session.assignedWorker) {
					// Start by removing the expectation
					const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
							reason: {
								user: 'Ready to start (after restart)',
								tech: 'Ready to start (after restart)',
							},
						})
					} else {
						// Something went wrong when trying to remove
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.RESTARTED,
							reason: removed.reason,
							isError: true,
						})
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.noWorkerAssigned(trackedExp)
				}
			} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.ABORTED) {
				await this.assignWorkerToSession(trackedExp)
				if (trackedExp.session.assignedWorker) {
					// Start by removing the expectation
					const removed = await trackedExp.session.assignedWorker.worker.removeExpectation(trackedExp.exp)
					if (removed.removed) {
						// This will cause the expectation to be intentionally stuck in the ABORTED state.
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
							reason: {
								user: 'Aborted',
								tech: 'Aborted',
							},
						})
					} else {
						// Something went wrong when trying to remove
						this.updateTrackedExpStatus(trackedExp, {
							state: ExpectedPackageStatusAPI.WorkStatusState.ABORTED,
							reason: removed.reason,
							isError: true,
						})
					}
				} else {
					// No worker is available at the moment.
					// Do nothing, hopefully some will be available at a later iteration
					this.noWorkerAssigned(trackedExp)
				}
			} else {
				assertNever(trackedExp.state)
			}
		} catch (err) {
			this.logger.error(
				`Error thrown in evaluateExpectationState for expectation "${expLabel(trackedExp)}": ${stringifyError(
					err
				)}`
			)
			this.updateTrackedExpStatus(trackedExp, {
				reason: {
					user: 'Internal error in Package Manager',
					tech: `${stringifyError(err)}`,
				},
				isError: true,
			})
		}
	}
	/** Returns the appropriate time to wait before checking a fulfilled expectation again */
	private getFullfilledWaitTime(): number {
		return (
			// Default minimum time to wait:
			this.constants.FULLFILLED_MONITOR_TIME +
			// Also add some more time, so that we don't check too often when we have a lot of expectations:
			this.trackedExpectationsCount * 0.02
		)
	}
	/** Update the state and status of a trackedExpectation */
	private updateTrackedExpStatus(
		trackedExp: TrackedExpectation,
		upd: {
			/** If set, sets a new state of the Expectation */
			state?: ExpectedPackageStatusAPI.WorkStatusState
			/** If set, sets a new reason of the Expectation */
			reason?: Reason
			/** If set, sets new status properties of the expectation */
			status?: Partial<TrackedExpectation['status']> | undefined
			/** Whether the new state is due an error or not */
			isError?: boolean
			/**
			 * If set, the package on packageContainer status won't be updated.
			 * This is used to defer updates in situations where we don't really know what the status of the package is.
			 * */
			dontUpdatePackage?: boolean
		}
	) {
		const { state, reason, status, isError, dontUpdatePackage } = upd

		trackedExp.lastEvaluationTime = Date.now()
		if (isError) {
			trackedExp.lastError = {
				time: Date.now(),
				reason: reason || { user: 'Unknown error', tech: 'Unknown error' },
			}
			if (trackedExp.session) trackedExp.session.hadError = true
		}

		const prevState: ExpectedPackageStatusAPI.WorkStatusState = trackedExp.state
		const prevReason: Reason = trackedExp.reason

		let updatedState = false
		let updatedReason = false
		let updatedStatus = false

		if (state !== undefined && trackedExp.state !== state) {
			trackedExp.state = state
			updatedState = true
		}

		if (reason && !_.isEqual(trackedExp.reason, reason)) {
			trackedExp.reason = reason
			updatedReason = true
		}
		if (updatedState || updatedReason) {
			trackedExp.prevStatusReasons[prevState] = {
				user: prevReason.user,
				tech: `${prevReason.tech} | ${new Date().toLocaleTimeString()}`,
			}
		}

		if (status) {
			const newStatus = Object.assign({}, trackedExp.status, status) // extend with new values
			if (!_.isEqual(trackedExp.status, newStatus)) {
				Object.assign(trackedExp.status, status)
				updatedStatus = true
			}
		}
		// Log and report new states an reasons:
		if (updatedState) {
			this.logger.debug(
				`${expLabel(trackedExp)}: New state: "${prevState}"->"${trackedExp.state}", reason: "${
					trackedExp.reason.tech
				}"`
			)
		} else if (updatedReason) {
			this.logger.debug(
				`${expLabel(trackedExp)}: State: "${trackedExp.state}", reason: "${trackedExp.reason.tech}"`
			)
		}

		if (updatedState || updatedReason || updatedStatus) {
			this.callbacks.reportExpectationStatus(trackedExp.id, trackedExp.exp, null, {
				progress: trackedExp.status.workProgress || 0,
				priority: trackedExp.exp.priority,
				status: updatedState || updatedReason ? trackedExp.state : undefined,
				statusReason: updatedReason ? trackedExp.reason : undefined,
				prevStatusReasons: trackedExp.prevStatusReasons,
			})
		}
		if (!dontUpdatePackage) {
			if (updatedState || updatedReason || updatedStatus) {
				this.updatePackageContainerPackageStatus(trackedExp, false)
			}
		}
	}
	private updatePackageContainerPackageStatus(trackedExp: TrackedExpectation, isRemoved: boolean) {
		for (const fromPackage of trackedExp.exp.fromPackages) {
			for (const packageContainer of trackedExp.exp.endRequirement.targets) {
				if (isRemoved) {
					this.callbacks.reportPackageContainerPackageStatus(
						packageContainer.containerId,
						fromPackage.id,
						null
					)
				} else {
					this.callbacks.reportPackageContainerPackageStatus(packageContainer.containerId, fromPackage.id, {
						contentVersionHash: trackedExp.status.actualVersionHash || '',
						progress: trackedExp.status.workProgress || 0,
						status: this.getPackageStatus(trackedExp),
						statusReason: trackedExp.reason,
						priority: trackedExp.exp.priority,

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
	private async assignWorkerToSession(trackedExp: TrackedExpectation): Promise<void> {
		const session: ExpectationStateHandlerSession | null = trackedExp.session
		if (!session) throw new Error('ExpectationManager: INternal error: Session not set')
		if (session.assignedWorker) return // A worker has already been assigned

		/** How many requests to send out simultaneously */
		const BATCH_SIZE = 10
		/** How many answers we want to have before continuing with picking one */
		const minWorkerCount = 5

		if (!Object.keys(trackedExp.availableWorkers).length) {
			session.noAssignedWorkerReason = { user: `No workers available`, tech: `No workers available` }
		}

		const workerCosts: WorkerAgentAssignment[] = []
		let noCostReason: Reason = {
			user: `${Object.keys(trackedExp.availableWorkers).length} workers are currently busy`,
			tech: `${Object.keys(trackedExp.availableWorkers).length} busy, ${
				Object.keys(trackedExp.queriedWorkers).length
			} queried`,
		}

		// Send a number of requests simultaneously:

		let countQueried = 0
		let countInfinite = 0

		// We're using PromisePool to query a batch of workers at a time:
		await PromisePool.for(Object.keys(trackedExp.availableWorkers))
			.withConcurrency(BATCH_SIZE)
			.handleError(async (error, workerId: string) => {
				// Log the error
				this.logger.error(`Error in assignWorkerToSession for worker "${workerId}": ${stringifyError(error)}`)
			})
			.process(async (workerId: string) => {
				// Abort if we have gotten enough answers:
				if (workerCosts.length >= minWorkerCount) return

				const workerAgent: TrackedWorkerAgent | undefined = this.workerAgents[workerId]
				if (workerAgent) {
					try {
						countQueried++
						const cost = await workerAgent.api.getCostForExpectation(trackedExp.exp)

						if (cost.cost < Number.POSITIVE_INFINITY) {
							workerCosts.push({
								worker: workerAgent.api,
								id: workerId,
								cost,
								randomCost: Math.random(), // To randomize if there are several with the same best cost
							})
						} else {
							noCostReason = cost.reason
							countInfinite++
						}
					} catch (error) {
						noCostReason = {
							user: 'Error: Internal Error',
							tech: `${stringifyError(error, true)}`,
						}
					}
				}
			})

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

		if (bestWorker) {
			session.assignedWorker = bestWorker
			trackedExp.noWorkerAssignedTime = null
		} else {
			session.noAssignedWorkerReason = {
				user: `Waiting for a free worker, ${noCostReason.user}`,
				tech: `Waiting for a free worker ${noCostReason} (${
					Object.keys(trackedExp.availableWorkers).length
				} busy, ${countQueried} asked, ${countInfinite} infinite cost)`,
			}
		}
	}
	/**
	 * Handle an Expectation that had no worker assigned
	 */
	private noWorkerAssigned(trackedExp: TrackedExpectation): void {
		if (!trackedExp.session) throw new Error('Internal error: noWorkerAssigned: session not set')
		if (trackedExp.session.assignedWorker)
			throw new Error('Internal error: noWorkerAssigned can only be called when assignedWorker is falsy')

		let noAssignedWorkerReason: ExpectedPackageStatusAPI.Reason
		if (!trackedExp.session.noAssignedWorkerReason) {
			this.logger.error(
				`trackedExp.session.noAssignedWorkerReason is undefined, although assignedWorker was set..`
			)
			noAssignedWorkerReason = {
				user: 'Unknown reason (internal error)',
				tech: 'Unknown reason',
			}
		} else {
			noAssignedWorkerReason = trackedExp.session.noAssignedWorkerReason
		}

		if (!trackedExp.noWorkerAssignedTime) trackedExp.noWorkerAssignedTime = Date.now()

		// Special case: When WAITING and no worker was assigned, return to NEW so that another worker might be assigned:
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
			this.updateTrackedExpStatus(trackedExp, {
				state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
				reason: noAssignedWorkerReason,
				// Don't update the package status, since this means that we don't know anything about the package:
				dontUpdatePackage: true,
			})
		} else {
			// only update the reason
			this.updateTrackedExpStatus(trackedExp, {
				reason: noAssignedWorkerReason,
				// Don't update the package status, since this means that we don't know anything about the package:
				dontUpdatePackage: true,
			})
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
		const waitingFor = this.isExpectationWaitingForOther(trackedExp)

		if (waitingFor) {
			return {
				ready: false,
				reason: {
					user: `Waiting for "${waitingFor.exp.statusReport.label}"`,
					tech: `Waiting for "${waitingFor.exp.statusReport.label}"`,
				},
				isWaitingForAnother: true,
			}
		}

		return workerAgent.isExpectationReadyToStartWorkingOn(trackedExp.exp)
	}
	/** Checks if the expectation is waiting for another expectation, and returns the awaited Expectation, otherwise null */
	private isExpectationWaitingForOther(trackedExp: TrackedExpectation): TrackedExpectation | null {
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
				return waitingFor
			}
		}
		return null
	}
	private async _updateReceivedPackageContainerExpectations() {
		this.receivedUpdates.packageContainersHasBeenUpdated = false

		// Added / Changed
		for (const containerId of Object.keys(this.receivedUpdates.packageContainers)) {
			const packageContainer: PackageContainerExpectation = this.receivedUpdates.packageContainers[containerId]

			let isNew = false
			let isUpdated = false
			if (!this.trackedPackageContainers[containerId]) {
				// new
				isUpdated = true
				isNew = true
			} else if (!_.isEqual(this.trackedPackageContainers[containerId].packageContainer, packageContainer)) {
				isUpdated = true
			}
			if (this.receivedUpdates.restartPackageContainers[containerId]) {
				isUpdated = true
			}
			let trackedPackageContainer: TrackedPackageContainerExpectation

			if (isNew) {
				trackedPackageContainer = {
					id: containerId,
					packageContainer: packageContainer,
					currentWorker: null,
					waitingForWorkerTime: null,
					isUpdated: true,
					removed: false,
					lastEvaluationTime: 0,
					monitorIsSetup: false,
					status: {
						status: StatusCode.UNKNOWN,
						statusReason: { user: '', tech: '' },
						statusChanged: 0,
						monitors: {},
					},
				}
				this.trackedPackageContainers[containerId] = trackedPackageContainer
			} else {
				trackedPackageContainer = this.trackedPackageContainers[containerId]
			}
			if (isUpdated) {
				trackedPackageContainer.packageContainer = packageContainer
				trackedPackageContainer.isUpdated = true
				trackedPackageContainer.removed = false

				if (isNew) {
					this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.UNKNOWN, {
						user: `Added just now`,
						tech: `Added ${Date.now()}`,
					})
				} else {
					this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.UNKNOWN, {
						user: `Updated just now`,
						tech: `Updated ${Date.now()}`,
					})
				}
			}
		}

		// Removed:
		for (const containerId of Object.keys(this.trackedPackageContainers)) {
			if (!this.receivedUpdates.packageContainers[containerId]) {
				// This packageContainersExpectation has been removed

				const trackedPackageContainer = this.trackedPackageContainers[containerId]
				if (trackedPackageContainer.currentWorker) {
					const workerAgent = this.workerAgents[trackedPackageContainer.currentWorker]
					if (workerAgent && workerAgent.connected) {
						try {
							const result = await workerAgent.api.disposePackageContainerMonitors(containerId)
							if (result.success) {
								trackedPackageContainer.removed = true
								this.callbacks.reportPackageContainerExpectationStatus(containerId, null)

								delete this.trackedPackageContainers[containerId]
							} else {
								this.logger.error(
									`ExpectationManager._updateReceivedPackageContainerExpectations: disposePackageContainerMonitors did not succeed: ${JSON.stringify(
										result.reason
									)}`
								)
								this.updateTrackedPackageContainerStatus(
									trackedPackageContainer,
									StatusCode.BAD,
									result.reason
								)
							}
						} catch (err) {
							this.logger.error(
								`ExpectationManager._updateReceivedPackageContainerExpectations: Caught exception: ${JSON.stringify(
									err
								)}`
							)
							this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.BAD, {
								user: 'Internal Error',
								tech: `Error when removing: ${stringifyError(err)}`,
							})
						}
					}
				}
			}
		}

		this.receivedUpdates.restartPackageContainers = {}
	}
	private async _evaluateAllTrackedPackageContainers(): Promise<void> {
		for (const trackedPackageContainer of Object.values(this.trackedPackageContainers)) {
			const startTime = Date.now()

			try {
				let badStatus = false
				trackedPackageContainer.lastEvaluationTime = Date.now()

				if (trackedPackageContainer.isUpdated) {
					// If the packageContainer was newly updated, reset and set up again:
					if (trackedPackageContainer.currentWorker) {
						const workerAgent = this.workerAgents[trackedPackageContainer.currentWorker]
						if (workerAgent && workerAgent.connected) {
							const disposeMonitorResult = await workerAgent.api.disposePackageContainerMonitors(
								trackedPackageContainer.id
							)
							if (!disposeMonitorResult.success) {
								badStatus = true
								this.logger.verbose(
									`ExpectationManager._evaluateAllTrackedPackageContainers: disposePackageContainerMonitors did not succeed: ${JSON.stringify(
										disposeMonitorResult.reason
									)}`
								)
								this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.BAD, {
									user: `Unable to restart monitor, due to ${disposeMonitorResult.reason.user}`,
									tech: `Unable to restart monitor: ${disposeMonitorResult.reason.tech}`,
								})
								continue // Break further execution for this PackageContainer
							}
						} else {
							// Lost connecttion to the worker & monitor
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
						Object.entries(this.workerAgents).map<Promise<void>>(async ([workerId, workerAgent]) => {
							if (!workerAgent.connected) return

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
					if (Object.keys(trackedPackageContainer.packageContainer.accessors).length > 0) {
						if (!trackedPackageContainer.currentWorker) {
							if (Object.keys(this.workerAgents).length) {
								notSupportReason = {
									user: 'Found no worker that supports this packageContainer',
									tech: 'Found no worker that supports this packageContainer',
								}
							} else {
								notSupportReason = {
									user: 'No workers available',
									tech: 'No workers available',
								}
							}
						}
					} else {
						notSupportReason = {
							user: 'The PackageContainer has no accessors',
							tech: 'The PackageContainer has no accessors',
						}
					}

					if (notSupportReason) {
						badStatus = true
						this.logger.verbose(
							`ExpectationManager._evaluateAllTrackedPackageContainers: doYouSupportPackageContainer could not find a supportive worker: ${JSON.stringify(
								notSupportReason
							)}`
						)
						this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.BAD, {
							user: `Unable to handle PackageContainer, due to: ${notSupportReason.user}`,
							tech: `Unable to handle PackageContainer, due to: ${notSupportReason.tech}`,
						})
						continue // Break further execution for this PackageContainer
					}
				}

				if (trackedPackageContainer.currentWorker) {
					const workerAgent = this.workerAgents[trackedPackageContainer.currentWorker]

					if (Object.keys(trackedPackageContainer.packageContainer.monitors).length !== 0) {
						if (!trackedPackageContainer.monitorIsSetup) {
							const monitorSetup = await workerAgent.api.setupPackageContainerMonitors(
								trackedPackageContainer.packageContainer
							)

							trackedPackageContainer.status.monitors = {}
							if (monitorSetup.success) {
								trackedPackageContainer.monitorIsSetup = true
								for (const [monitorId, monitor] of Object.entries(monitorSetup.monitors)) {
									if (trackedPackageContainer.status.monitors[monitorId]) {
										// In case there no monitor status has been emitted yet:
										this.updateTrackedPackageContainerMonitorStatus(
											trackedPackageContainer,
											monitorId,
											monitor.label,
											StatusCode.UNKNOWN,
											{
												user: 'Setting up monitor...',
												tech: 'Setting up monitor...',
											}
										)
									}
								}
							} else {
								badStatus = true
								this.logger.verbose(
									`ExpectationManager._evaluateAllTrackedPackageContainers: setupPackageContainerMonitors did not suceed: ${JSON.stringify(
										monitorSetup.reason
									)}`
								)
								this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.BAD, {
									user: `Unable to set up monitors for PackageContainer, due to: ${monitorSetup.reason.user}`,
									tech: `Unable to set up monitors for PackageContainer, due to: ${monitorSetup.reason.tech}`,
								})
							}
						}
					}

					const cronJobStatus = await workerAgent.api.runPackageContainerCronJob(
						trackedPackageContainer.packageContainer
					)
					if (!cronJobStatus.success) {
						badStatus = true
						this.logger.verbose(
							`ExpectationManager._evaluateAllTrackedPackageContainers: runPackageContainerCronJob did not suceed: ${JSON.stringify(
								cronJobStatus.reason
							)}`
						)
						this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.BAD, {
							user: 'Cron job not completed, due to: ' + cronJobStatus.reason.user,
							tech: 'Cron job not completed, due to: ' + cronJobStatus.reason.tech,
						})
						continue
					}
				}

				if (!badStatus) {
					this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.GOOD, {
						user: `All good`,
						tech: `All good`,
					})
				}
			} catch (err) {
				this.logger.error(`ExpectationManager._evaluateAllTrackedPackageContainers: ${JSON.stringify(err)}`)
				this.updateTrackedPackageContainerStatus(trackedPackageContainer, StatusCode.BAD, {
					user: 'Internal Error',
					tech: `Unhandled Error: ${stringifyError(err)}`,
				})
			}
			this.logger.debug(
				`trackedPackageContainer ${trackedPackageContainer.id}, took ${Date.now() - startTime} ms`
			)
		}
	}
	/** Update the status of a PackageContainer */
	private updateTrackedPackageContainerStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		status: StatusCode,
		statusReason: Reason
	) {
		if (trackedPackageContainer.removed) return

		let updatedStatus = false
		trackedPackageContainer.status.statusChanged = Date.now()

		if (trackedPackageContainer.status.status !== status) {
			trackedPackageContainer.status.status = status
			updatedStatus = true
		}
		if (trackedPackageContainer.status.statusReason !== statusReason) {
			trackedPackageContainer.status.statusReason = statusReason
			updatedStatus = true
		}

		if (updatedStatus) {
			this.callbacks.reportPackageContainerExpectationStatus(
				trackedPackageContainer.id,
				trackedPackageContainer.status
			)
		}
	}
	/** Update the status of a PackageContainer monitor */
	private updateTrackedPackageContainerMonitorStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		monitorId: string,
		monitorLabel: string | undefined,
		status: StatusCode,
		statusReason: Reason
	) {
		if (trackedPackageContainer.removed) return

		let updatedStatus = false
		trackedPackageContainer.status.statusChanged = Date.now()

		const existingMonitorStatus = trackedPackageContainer.status.monitors[monitorId]
		const newMonitorStatus: ExpectedPackageStatusAPI.PackageContainerMonitorStatus = {
			label: monitorLabel || existingMonitorStatus?.label || monitorId,
			status: status,
			statusReason: statusReason,
		}

		if (!existingMonitorStatus || !deepEqual(existingMonitorStatus, newMonitorStatus)) {
			trackedPackageContainer.status.monitors[monitorId] = newMonitorStatus
			updatedStatus = true
		}

		if (updatedStatus) {
			this.callbacks.reportPackageContainerExpectationStatus(
				trackedPackageContainer.id,
				trackedPackageContainer.status
			)
		}
	}
	private updateStatusReport(times?: { [key: string]: number }): ExpectationManagerStatusReport {
		const statusReport = {
			id: this.managerId,
			updated: Date.now(),
			expectationStatistics: {
				countTotal: 0,

				countNew: 0,
				countWaiting: 0,
				countReady: 0,
				countWorking: 0,
				countFulfilled: 0,
				countRemoved: 0,
				countRestarted: 0,
				countAborted: 0,

				countNoAvailableWorkers: 0,
				countError: 0,
			},
			times: times || {},
			workerAgents: Object.entries(this.workerAgents).map(([id, _workerAgent]) => {
				return {
					workerId: id,
				}
			}),
			worksInProgress: Object.entries(this.worksInProgress).map(([id, wip]) => {
				return {
					id: id,
					lastUpdated: wip.lastUpdated,
					workerId: wip.workerId,
					cost: wip.cost,
					label: wip.trackedExp.exp.statusReport.label,
					progress: Math.floor((wip.trackedExp.status.workProgress || 0) * 1000) / 1000,
					expectationId: wip.trackedExp.id,
				}
			}),
		}
		const expectationStatistics = statusReport.expectationStatistics
		for (const exp of Object.values(this.trackedExpectations)) {
			expectationStatistics.countTotal++

			if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW) {
				expectationStatistics.countNew++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
				expectationStatistics.countWaiting++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.READY) {
				expectationStatistics.countReady++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				expectationStatistics.countWorking++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
				expectationStatistics.countFulfilled++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.REMOVED) {
				expectationStatistics.countRemoved++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.RESTARTED) {
				expectationStatistics.countRestarted++
			} else if (exp.state === ExpectedPackageStatusAPI.WorkStatusState.ABORTED) {
				expectationStatistics.countAborted++
			} else assertNever(exp.state)

			if (Object.keys(exp.availableWorkers).length === 0) {
				expectationStatistics.countNoAvailableWorkers++
			}
			if (
				exp.errorCount > 0 &&
				exp.state !== ExpectedPackageStatusAPI.WorkStatusState.WORKING &&
				exp.state !== ExpectedPackageStatusAPI.WorkStatusState.FULFILLED
			) {
				expectationStatistics.countError++
			}
		}
		return statusReport
	}
	private async checkIfNeedToScaleUp(): Promise<void> {
		const waitingExpectations: TrackedExpectation[] = []
		const waitingPackageContainers: TrackedPackageContainerExpectation[] = []

		let requestsSentCount = 0

		for (const exp of Object.values(this.trackedExpectations)) {
			/** The expectation is waiting for a worker */
			const isWaiting: boolean =
				exp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW ||
				exp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING ||
				exp.state === ExpectedPackageStatusAPI.WorkStatusState.READY

			/** Not supported by any worker */
			const notSupportedByAnyWorker: boolean = Object.keys(exp.availableWorkers).length === 0
			/** No worker has had time to work on it lately */
			const notAssignedToAnyWorker: boolean =
				!!exp.noWorkerAssignedTime && Date.now() - exp.noWorkerAssignedTime > this.constants.SCALE_UP_TIME

			if (
				isWaiting &&
				(notSupportedByAnyWorker || notAssignedToAnyWorker) &&
				!this.isExpectationWaitingForOther(exp) // Filter out expectations that aren't ready to begin working on anyway
			) {
				if (!exp.waitingForWorkerTime) {
					exp.waitingForWorkerTime = Date.now()
				}
			} else {
				exp.waitingForWorkerTime = null
			}
			if (exp.waitingForWorkerTime) {
				if (
					Date.now() - exp.waitingForWorkerTime > this.constants.SCALE_UP_TIME || // Don't scale up too fast
					Object.keys(this.workerAgents).length === 0 // Although if there are no workers connected, we should scale up right away
				) {
					waitingExpectations.push(exp)
				}
			}
		}
		for (const exp of waitingExpectations) {
			if (requestsSentCount < this.constants.SCALE_UP_COUNT) {
				requestsSentCount++
				this.logger.debug(`Requesting more resources to handle expectation "${expLabel(exp)}"`)
				await this.workforceAPI.requestResourcesForExpectation(exp.exp)
			}
		}

		for (const packageContainer of Object.values(this.trackedPackageContainers)) {
			if (!packageContainer.currentWorker) {
				if (!packageContainer.waitingForWorkerTime) {
					packageContainer.waitingForWorkerTime = Date.now()
				}
			} else {
				packageContainer.waitingForWorkerTime = null
			}
			if (
				packageContainer.waitingForWorkerTime &&
				Date.now() - packageContainer.waitingForWorkerTime > this.constants.SCALE_UP_TIME
			) {
				waitingPackageContainers.push(packageContainer)
			}
		}
		for (const packageContainer of waitingPackageContainers) {
			if (requestsSentCount < this.constants.SCALE_UP_COUNT) {
				requestsSentCount++
				this.logger.debug(`Requesting more resources to handle packageContainer "${packageContainer.id}"`)
				await this.workforceAPI.requestResourcesForPackageContainer(packageContainer.packageContainer)
			}
		}

		this.waitingExpectations = waitingExpectations
	}
	/** Monitor the Works in progress, to restart them if necessary */
	private monitorWorksInProgress() {
		for (const [wipId, wip] of Object.entries(this.worksInProgress)) {
			if (wip.trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
				if (Date.now() - wip.lastUpdated > this.constants.WORK_TIMEOUT_TIME) {
					// It seems that the work has stalled..

					this.logger.warn(`Work "${wipId}" on exp "${expLabel(wip.trackedExp)}" has stalled, restarting it`)

					// Restart the job:
					const reason: Reason = {
						tech: 'WorkInProgress timeout',
						user: 'The job timed out',
					}

					wip.trackedExp.errorCount++
					this.updateTrackedExpStatus(wip.trackedExp, {
						state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
						reason,
					})
					delete this.worksInProgress[wipId]

					// Send a cancel request to the worker as a courtesy:
					wip.worker.cancelWorkInProgress(wip.wipId).catch((err) => {
						this.logger.error(`Error when cancelling timed out work "${wipId}" ${stringifyError(err)}`)
					})
				}
			} else {
				// huh, it seems that we have a workInProgress, but the trackedExpectation is not WORKING
				this.logger.error(
					`WorkInProgress ${wipId} has an exp (${expLabel(wip.trackedExp)}) which is not working..`
				)
				delete this.worksInProgress[wipId]
			}
		}
	}
	private _updateStatus(id: string, status: { statusCode: StatusCode; message: string } | null) {
		this.statuses[id] = status

		const statusHash = hashObj(this.statuses)
		if (this.emittedStatusHash !== statusHash) {
			this.emittedStatusHash = statusHash
			this.emit('status', this.statuses)
		}
	}
	private _monitorStatus() {
		// If the work-queue is long (>10 items) and nothing has progressed for the past 10 minutes.

		if (this.waitingExpectations.length > 10) {
			if (!this.monitorStatusWaiting) {
				this.monitorStatusWaiting = Date.now()
			}
		} else {
			this.monitorStatusWaiting = null
		}

		const stuckDuration: number = this.monitorStatusWaiting ? Date.now() - this.monitorStatusWaiting : 0
		if (stuckDuration > 10 * 60 * 1000) {
			this.logger.error(
				`ExpectationManager._monitorStatus: Work Queue is Stuck for ${stuckDuration / 1000 / 60} minutes`
			)
			this._updateStatus('work-queue-stuck', {
				statusCode: StatusCode.BAD,
				message: `The Work-queue has been stuck for ${Math.round(
					stuckDuration / 1000 / 60
				)} minutes, and there are ${this.waitingExpectations.length} waiting`,
			})
		} else {
			this._updateStatus('work-queue-stuck', { statusCode: StatusCode.GOOD, message: '' })
		}
	}
}
function expLabel(exp: TrackedExpectation): string {
	let id = `${exp.id}`
	if (id.length > 16) {
		id = id.slice(0, 8) + '...' + id.slice(-8)
	}

	return `${id} ${exp.exp.statusReport.label.slice(0, 50)}`
}
export interface ExpectationManagerOptions {
	constants?: Partial<ExpectationManagerConstants>
	chaosMonkey?: boolean
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

interface TrackedWorkerAgent {
	api: WorkerAgentAPI
	connected: boolean
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
			priority?: number
			statusReason?: Reason
			prevStatusReasons?: { [status: string]: Reason }
		}
	) => void
	reportPackageContainerPackageStatus: (
		containerId: string,
		packageId: string,
		packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
	) => void
	reportPackageContainerExpectationStatus: (
		containerId: string,
		statusInfo: ExpectedPackageStatusAPI.PackageContainerStatus | null
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

	/** The currently assigned Worker */
	currentWorker: string | null
	/** Timestamp to track how long the packageContainer has been waiting for a worker (can't start working), used to request more resources */
	waitingForWorkerTime: number | null

	/** Timestamp of the last time the expectation was evaluated. */
	lastEvaluationTime: number

	/** If the monitor is set up okay */
	monitorIsSetup: boolean

	/** These statuses are sent from the workers */
	status: ExpectedPackageStatusAPI.PackageContainerStatus

	/** Is set if the packageContainer has been removed */
	removed: boolean
}
