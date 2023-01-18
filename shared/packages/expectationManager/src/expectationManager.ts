import {
	StatusCode,
	Expectation,
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
	HelpfulEventEmitter,
	Statuses,
	hashObj,
	setLogLevel,
} from '@sofie-package-manager/api'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { WorkforceAPI } from './workforceApi'
import { WorkerAgentAPI } from './workerAgentApi'
import PromisePool from '@supercharge/promise-pool'
import { ExpectationTrackerConstants, getDefaultConstants } from './lib/constants'
import { ExpectationStateHandlerSession, WorkerAgentAssignment } from './lib/types'
import { getPackageStatus } from './lib/expectations'
import { ExpectationTracker, TrackedExpectation, TrackedPackageContainerExpectation } from './expectationTracker'
import { TrackedWorkerAgents } from './helpers/trackedWorkerAgents'

/**
 * The Expectation Manager is responsible for tracking the state of the Expectations,
 * and communicate with the Workers to progress them.
 * @see FOR_DEVELOPERS.md
 */

export class ExpectationManager extends HelpfulEventEmitter {
	private tracker: ExpectationTracker

	private enableChaosMonkey = false

	public workforceAPI: WorkforceAPI

	private websocketServer?: WebsocketServer

	public workerAgents: TrackedWorkerAgents

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
		public callbacks: ExpectationManagerCallbacks,
		options?: ExpectationManagerOptions
	) {
		super()
		this.logger = logger.category('ExpectationManager')

		const constants = {
			...getDefaultConstants(),
			...options?.constants,
		}
		this.tracker = new ExpectationTracker(this, this.logger, constants, callbacks)
		this.workerAgents = new TrackedWorkerAgents()

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

		this.statusReport = this.getManagerStatusReport()
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
							this.workerAgents.upsert(client.clientId, { api, connected: true })
							client.once('close', () => {
								this.logger.warn(`ExpectationManager: Connection to Worker "${client.clientId}" closed`)

								const workerAgent = this.workerAgents.get(client.clientId)
								if (workerAgent) {
									workerAgent.connected = false
									this.workerAgents.remove(client.clientId)
								}
							})
							this.logger.info(
								`ExpectationManager: Connection to Worker "${client.clientId}" established`
							)
							this.tracker.triggerEvaluateExpectationsNow()
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

		this.tracker.triggerEvaluateExpectationsNow()

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
		this.tracker.terminate()
		if (this.websocketServer) {
			this.websocketServer.terminate()
		}

		if (this.statusMonitorInterval) {
			clearInterval(this.statusMonitorInterval)
			this.statusMonitorInterval = null
		}
	}
	/** USED IN TESTS ONLY. Quickly reset the tracked work of the expectationManager. */
	resetWork(): void {
		this.tracker.resetWork()
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
			this.workerAgents.upsert(clientId, { api, connected: true })

			return workerAgentMethods
		}
	}
	removeWorkerAgentHook(clientId: string): void {
		const workerAgent = this.workerAgents.get(clientId)
		if (!workerAgent) throw new Error(`WorkerAgent "${clientId}" not found!`)

		if (workerAgent.api.type !== 'internal')
			throw new Error(`Cannot remove WorkerAgent "${clientId}", due to the type being "${workerAgent.api.type}"`)

		workerAgent.connected = false
		this.workerAgents.remove(clientId)
	}
	/** Called when there is an updated set of PackageContainerExpectations. */
	updatePackageContainerExpectations(packageContainers: { [id: string]: PackageContainerExpectation }): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.tracker.receivedUpdates.packageContainers = packageContainers
		this.tracker.triggerEvaluateExpectationsNow()
	}
	/** Called when there is an updated set of Expectations. */
	updateExpectations(expectations: { [id: string]: Expectation.Any }): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.tracker.receivedUpdates.expectations = expectations

		this.tracker.triggerEvaluateExpectationsNow()
	}
	/** Request that an Expectation is restarted. This functions returns immediately, not waiting for a result. */
	restartExpectation(expectationId: string): void {
		this.tracker.receivedUpdates.restartExpectations[expectationId] = true
		this.tracker.triggerEvaluateExpectationsNow()
	}
	/** Request that all Expectations are restarted. This functions returns immediately, not waiting for a result. */
	restartAllExpectations(): void {
		this.tracker.receivedUpdates.restartAllExpectations = true
		this.tracker.triggerEvaluateExpectationsNow()
	}
	/** Request that an Expectation is aborted.
	 * "Aborted" means that any current work is cancelled and any finished work will be removed.
	 * Any future attempts to check on the Expectation will be ignored.
	 * To un-Abort, call this.restartExpectation().
	 * This functions returns immediately, not waiting for a result. */
	abortExpectation(expectationId: string): void {
		this.tracker.receivedUpdates.abortExpectations[expectationId] = true
		this.tracker.triggerEvaluateExpectationsNow()
	}
	restartPackageContainer(containerId: string): void {
		this.tracker.receivedUpdates.restartPackageContainers[containerId] = true

		this.tracker.triggerEvaluateExpectationsNow()
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
	public getTroubleshootData(): any {
		return {
			trackedExpectations: this.getTrackedExpectations(),
			workers: this.workerAgents,
		}
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
				await this.tracker.worksInProgress.onWipEventProgress(clientId, wipId, actualVersionHash, progress)
			},
			wipEventDone: async (
				wipId: number,
				actualVersionHash: string,
				reason: Reason,
				result: any
			): Promise<void> => {
				await this.tracker.worksInProgress.onWipEventDone(clientId, wipId, actualVersionHash, reason, result)
			},
			wipEventError: async (wipId: number, reason: Reason): Promise<void> => {
				await this.tracker.worksInProgress.onWipEventError(clientId, wipId, reason)
			},
			monitorStatus: async (
				packageContainerId: string,
				monitorId: string,
				status: StatusCode,
				reason: Reason
			) => {
				await this.tracker.onMonitorStatus(packageContainerId, monitorId, status, reason)
			},
		}
	}

	private getTrackedExpectations(): TrackedExpectation[] {
		return this.tracker.getSortedTrackedExpectations()
	}

	public updatePackageContainerPackageStatus(trackedExp: TrackedExpectation, isRemoved: boolean): void {
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
						status: getPackageStatus(trackedExp),
						statusReason: trackedExp.reason,
						priority: trackedExp.exp.priority,

						isPlaceholder: !!trackedExp.status.sourceIsPlaceholder,
					})
				}
			}
		}
	}

	/** Do a bidding between the available Workers and assign the cheapest one to use for the evaulation-session. */
	public async assignWorkerToSession(trackedExp: TrackedExpectation): Promise<void> {
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

				const workerAgent = this.workerAgents.get(workerId)
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

	/** Update the status of a PackageContainer */
	public updateTrackedPackageContainerStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		status: StatusCode,
		statusReason: Reason
	): void {
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
	public updateTrackedPackageContainerMonitorStatus(
		trackedPackageContainer: TrackedPackageContainerExpectation,
		monitorId: string,
		monitorLabel: string | undefined,
		status: StatusCode,
		statusReason: Reason
	): void {
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
	public updateManagerStatusReport(times?: { [key: string]: number }): void {
		this.statusReport = this.getManagerStatusReport(times)
	}
	private getManagerStatusReport(times?: { [key: string]: number }): ExpectationManagerStatusReport {
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
			workerAgents: this.workerAgents.list().map(({ workerId }) => {
				return {
					workerId: workerId,
				}
			}),
			worksInProgress: Object.entries(this.tracker.worksInProgress.getWorksInProgress()).map(([id, wip]) => {
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
		for (const exp of this.tracker.getSortedTrackedExpectations()) {
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

		if (this.tracker.waitingExpectations.length > 10) {
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
				)} minutes, and there are ${this.tracker.waitingExpectations.length} waiting`,
			})
		} else {
			this._updateStatus('work-queue-stuck', { statusCode: StatusCode.GOOD, message: '' })
		}
	}
}

export interface ExpectationManagerOptions {
	constants?: Partial<ExpectationTrackerConstants>
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
