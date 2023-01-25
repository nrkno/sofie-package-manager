import {
	StatusCode,
	ClientConnectionOptions,
	ExpectationManagerWorkerAgent,
	WebsocketServer,
	ClientConnection,
	Hook,
	LoggerInstance,
	Reason,
	assertNever,
	ExpectationManagerStatusReport,
	LogLevel,
	deepEqual,
	stringifyError,
	Statuses,
	setLogLevel,
} from '@sofie-package-manager/api'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { WorkforceAPI } from '../workforceApi'
import { WorkerAgentAPI } from '../workerAgentApi'

import { getDefaultConstants } from '../lib/constants'
import { ExpectationStateHandlerSession } from '../lib/types'

import { ExpectationTracker } from '../expectationTracker/expectationTracker'
import { TrackedWorkerAgents } from './lib/trackedWorkerAgents'
import { ManagerStatusMonitor } from './lib/managerStatusMonitor'
import {
	ExpectationManagerCallbacks,
	ExpectationManagerOptions,
	ExpectationManagerServerOptions,
} from '../expectationManager'
import { ManagerStatusReporter } from './lib/managerStatusReporter'
import { TrackedExpectation } from '../lib/trackedExpectation'
import { TrackedPackageContainerExpectation } from '../lib/trackedPackageContainerExpectation'

/**
 * ExpectationManagerInternal contains methods that are used internally in this library.
 * It is used by ExpectationManager.
 *
 */

export class ExpectationManagerInternal {
	public workforceAPI: WorkforceAPI
	private websocketServer?: WebsocketServer
	private initWorkForceAPIPromise?: { resolve: () => void; reject: (reason?: any) => void }
	private serverAccessUrl = ''

	private enableChaosMonkey = false

	public tracker: ExpectationTracker

	public workerAgents: TrackedWorkerAgents
	private statuses: ManagerStatusReporter
	private managerMonitor: ManagerStatusMonitor

	public statusReport: ExpectationManagerStatusReport

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
		this.logger = logger.category('ExpectationManager')

		const constants = {
			...getDefaultConstants(),
			...options?.constants,
		}
		this.tracker = new ExpectationTracker(this, this.logger, constants, callbacks)
		this.workerAgents = new TrackedWorkerAgents(this.logger, this.tracker)

		this.statuses = new ManagerStatusReporter(this.callbacks)

		this.enableChaosMonkey = options?.chaosMonkey ?? false
		this.workforceAPI = new WorkforceAPI(this.logger)
		this.workforceAPI.on('disconnected', () => {
			this.logger.warn('Workforce disconnected')
			this.statuses.update('workforce', {
				statusCode: StatusCode.BAD,
				message: 'Workforce disconnected (Restart Package Manager if this persists)',
			})
		})
		this.workforceAPI.on('connected', () => {
			this.logger.info('Workforce connected')
			this.statuses.update('workforce', { statusCode: StatusCode.GOOD, message: '' })

			this.workforceAPI
				.registerExpectationManager(this.managerId, this.serverAccessUrl)
				.then(() => {
					this.initWorkForceAPIPromise?.resolve() // To finish the init() function
				})
				.catch((err) => {
					this.logger.error(`Error in registerExpectationManager: ${stringifyError(err)}`)
					this.initWorkForceAPIPromise?.reject(err)
				})
		})
		this.workforceAPI.on('error', (err) => {
			this.logger.error(`Workforce error event: ${stringifyError(err)}`)
		})

		this.statusReport = this.getManagerStatusReport()
		if (this.serverOptions.type === 'websocket') {
			this.websocketServer = new WebsocketServer(
				this.serverOptions.port,
				this.logger,
				(client: ClientConnection) => {
					// A new client has connected

					this.logger.info(`New ${client.clientType} connected, id "${client.clientId}"`)

					switch (client.clientType) {
						case 'workerAgent': {
							const expectationManagerMethods = this.getWorkerAgentAPI(client.clientId)

							const api = new WorkerAgentAPI(expectationManagerMethods, {
								type: 'websocket',
								clientConnection: client,
							})
							this.workerAgents.upsert(client.clientId, { api, connected: true })
							client.once('close', () => {
								this.logger.warn(`Connection to Worker "${client.clientId}" closed`)

								const workerAgent = this.workerAgents.get(client.clientId)
								if (workerAgent) {
									workerAgent.connected = false
									this.workerAgents.remove(client.clientId)
								}
							})
							this.logger.info(`Connection to Worker "${client.clientId}" established`)
							this.tracker.triggerEvaluateExpectationsNow()
							break
						}
						case 'N/A':
						case 'expectationManager':
						case 'appContainer':
							throw new Error(`Unsupported clientType "${client.clientType}"`)
						default: {
							assertNever(client.clientType)
							throw new Error(`Unknown clientType "${client.clientType}"`)
						}
					}
				}
			)

			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`WebsocketServer closed`)
				this.statuses.update('expectationManager.server', {
					statusCode: StatusCode.FATAL,
					message: 'ExpectationManager server closed (Restart Package Manager)',
				})
			})
			this.logger.info(`Expectation Manager running on port ${this.websocketServer.port}`)
		} else {
			// todo: handle direct connections
		}

		this.managerMonitor = new ManagerStatusMonitor(this.logger, this.tracker, this.statuses)
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

		this.logger.info(`Initialized"`)
	}

	terminate(): void {
		this.tracker.terminate()
		if (this.websocketServer) {
			this.websocketServer.terminate()
		}
		this.managerMonitor.terminate()
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
	/** USED IN TESTS ONLY. Quickly reset the tracked work of the expectationManager. */
	resetWork(): void {
		this.tracker.resetWork()
	}
	/** USED IN TESTS ONLY. Send out a message to all connected processes that they are to cut their connections. This is to test resilience. */
	async sendDebugKillConnections(): Promise<void> {
		await this.workforceAPI._debugSendKillConnections()
	}
	/** FOR DEBUGGING ONLY. Cut websocket connections, in order to ensure that they are restarted */
	async _debugSendKillConnections(): Promise<void> {
		this.workforceAPI.debugCutConnection()
		// note: workers cut their own connections
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

	async onWorkForceStatus(statuses: Statuses): Promise<void> {
		for (const [id, status] of Object.entries(statuses)) {
			this.statuses.update(`workforce-${id}`, status)
		}
	}

	async setLogLevelOfApp(appId: string, logLevel: LogLevel): Promise<void> {
		return this.workforceAPI.setLogLevelOfApp(appId, logLevel)
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
						status: this.getPackageStatus(trackedExp),
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
		if (!session) throw new Error('ExpectationManager: Internal error: Session not set')
		if (session.assignedWorker) return // A worker has already been assigned

		if (!Object.keys(trackedExp.availableWorkers).length) {
			session.noAssignedWorkerReason = { user: `No workers available`, tech: `No workers available` }
		}

		// Send a number of requests simultaneously:

		const { bestWorker, countQueried, countInfinite, noCostReason } =
			await this.workerAgents.determineBestWorkerForExpectation(trackedExp)

		if (bestWorker) {
			session.assignedWorker = bestWorker
			trackedExp.noWorkerAssignedTime = null
		} else {
			session.noAssignedWorkerReason = {
				user: `Waiting for a free worker, ${noCostReason.user}`,
				tech: `Waiting for a free worker ${noCostReason.tech} (${
					Object.keys(trackedExp.availableWorkers).length
				} busy, ${countQueried} asked, ${countInfinite} infinite cost)`,
			}
		}
	}

	/**
	 * Update the status of a PackageContainer.
	 * This is called by EvaluationRunner.
	 */
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
}
