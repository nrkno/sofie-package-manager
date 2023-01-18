import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import {
	Expectation,
	HelpfulEventEmitter,
	LoggerInstance,
	PackageContainerExpectation,
	Reason,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	StatusCode,
} from '@sofie-package-manager/api'
import _ from 'underscore'
import { EvaluationScheduler } from './evaluationScheduler'
import { ExpectationManager, ExpectationManagerCallbacks } from './expectationManager'
import { ListeningExpectations } from './helpers/listeningExpectations'
import { TrackedExpectations } from './helpers/trackedExpectations'
import { TrackedPackageContainers } from './helpers/trackedPackageContainers'
import { ExpectationTrackerConstants } from './lib/constants'
import { ExpectationStateHandlerSession } from './lib/types'
import { WorkerAgentAPI } from './workerAgentApi'
import { WorkInProgressTracker } from './helpers/workInProgressTracker'
import { TrackedReceivedUpdates } from './helpers/trackedReceivedUpdates'

/**
 * The ExpectationTracker is responsible for tracking and uptating the state of the Expectations
 */
export class ExpectationTracker extends HelpfulEventEmitter {
	public constants: ExpectationTrackerConstants
	private scheduler: EvaluationScheduler

	/** Store for various incoming data, to be processed on next iteration round */
	public receivedUpdates: TrackedReceivedUpdates

	/** This is the main store of all Tracked Expectations */
	public trackedExpectations: TrackedExpectations
	public waitingExpectations: TrackedExpectation[] = []

	public trackedPackageContainers: TrackedPackageContainers

	public listeningExpectations: ListeningExpectations

	public worksInProgress: WorkInProgressTracker

	private logger: LoggerInstance
	constructor(
		private manager: ExpectationManager,
		logger: LoggerInstance,
		constants: ExpectationTrackerConstants,
		private callbacks: ExpectationManagerCallbacks
	) {
		super()
		this.logger = logger.category('Tracker')
		this.constants = constants

		this.scheduler = new EvaluationScheduler(this.logger, this.manager, this)
		this.worksInProgress = new WorkInProgressTracker(this.logger, this)

		this.listeningExpectations = new ListeningExpectations(this.logger, this)
		this.trackedExpectations = new TrackedExpectations(this)
		this.trackedPackageContainers = new TrackedPackageContainers()

		this.receivedUpdates = new TrackedReceivedUpdates()
	}
	public terminate(): void {
		this.scheduler.terminate()
	}
	public resetWork(): void {
		this.receivedUpdates.clear()
		this.trackedExpectations.clear()
		this.trackedPackageContainers.clear()

		this.scheduler.triggerEvaluateExpectations(true)
	}
	public triggerEvaluateExpectationsNow(): void {
		this.scheduler.triggerEvaluateExpectations(true)
	}
	/** Update the state and status of a trackedExpectation */
	public updateTrackedExpStatus(
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
	): void {
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
				this.manager.updatePackageContainerPackageStatus(trackedExp, false)
			}
		}
	}
	/** Calls workerAgent.isExpectationReadyToStartWorkingOn() */
	public async isExpectationReadyToStartWorkingOn(
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
	public isExpectationWaitingForOther(trackedExp: TrackedExpectation): TrackedExpectation | null {
		if (trackedExp.exp.dependsOnFullfilled?.length) {
			// Check if those are fullfilled:
			let waitingFor: TrackedExpectation | undefined = undefined
			for (const id of trackedExp.exp.dependsOnFullfilled) {
				const trackedExp = this.trackedExpectations.get(id)
				if (trackedExp && trackedExp.state !== ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
					waitingFor = trackedExp
					break
				}
			}
			if (waitingFor) {
				return waitingFor
			}
		}
		return null
	}
	/**
	 * To be called when trackedExp.status turns fullfilled.
	 * Triggers any other expectations that listens to (are dependant on) the fullfilled one.
	 * @returns true if any other expectations where triggered (ie evaluation should run again ASAP)
	 */
	public onExpectationFullfilled(fullfilledExp: TrackedExpectation): boolean {
		let hasTriggeredSomething = false
		if (fullfilledExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
			const expectationsToTrigger = this.listeningExpectations.getListeningExpectations(fullfilledExp.id)

			// Go through the listening expectations and mark them to be re-evaluated ASAP:
			for (const id of expectationsToTrigger) {
				const toTriggerExp = this.trackedExpectations.get(id)
				if (toTriggerExp) {
					toTriggerExp.lastEvaluationTime = 0 // so that it reruns ASAP
					hasTriggeredSomething = true
				}
			}
		}
		return hasTriggeredSomething
	}

	/** Returns the appropriate time to wait before checking a fulfilled expectation again */
	public getFullfilledWaitTime(): number {
		return (
			// Default minimum time to wait:
			this.constants.FULLFILLED_MONITOR_TIME +
			// Also add some more time, so that we don't check too often when we have a lot of expectations:
			this.trackedExpectations.getIds().length * 0.02
		)
	}
	/** Called when there is a monitor-status-update from a worker */
	public async onMonitorStatus(
		packageContainerId: string,
		monitorId: string,
		status: StatusCode,
		reason: Reason
	): Promise<void> {
		const trackedPackageContainer = this.trackedPackageContainers.get(packageContainerId)
		if (!trackedPackageContainer) {
			this.logger.error(`Worker reported status on unknown packageContainer "${packageContainerId}"`)
			return
		}
		trackedPackageContainer.status.statusChanged = Date.now()

		this.manager.updateTrackedPackageContainerMonitorStatus(
			trackedPackageContainer,
			monitorId,
			undefined,
			status,
			reason
		)
	}
	public getTrackedPackageContainers(): TrackedPackageContainerExpectation[] {
		return Object.values(this.trackedPackageContainers)
	}

	/**
	 * Goes through the expectations and checks if there are too many expectations waiting for workers
	 * and tries to scale up new workers if needed.
	 * Called when a pass of evaluating expectation has finished
	 */
	public async checkIfNeedToScaleUp(): Promise<void> {
		const waitingExpectations: TrackedExpectation[] = []
		const waitingPackageContainers: TrackedPackageContainerExpectation[] = []

		let requestsSentCount = 0

		for (const exp of this.trackedExpectations.list()) {
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
					this.manager.workerAgents.list().length === 0 // Although if there are no workers connected, we should scale up right away
				) {
					waitingExpectations.push(exp)
				}
			}
		}
		for (const exp of waitingExpectations) {
			if (requestsSentCount < this.constants.SCALE_UP_COUNT) {
				requestsSentCount++
				this.logger.debug(`Requesting more resources to handle expectation "${expLabel(exp)}"`)
				await this.manager.workforceAPI.requestResourcesForExpectation(exp.exp)
			}
		}

		for (const packageContainer of this.getTrackedPackageContainers()) {
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
				await this.manager.workforceAPI.requestResourcesForPackageContainer(packageContainer.packageContainer)
			}
		}

		this.waitingExpectations = waitingExpectations
	}
	public getSortedTrackedExpectations(): TrackedExpectation[] {
		return this.trackedExpectations.list()
	}
	/**
	 * Handle an Expectation that had no worker assigned
	 */
	public noWorkerAssigned(trackedExp: TrackedExpectation): void {
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
}
/** Persistant data structure used to track the progress of an Expectation */
export interface TrackedExpectation {
	/** Unique ID of the tracked expectation */
	id: string
	/** The Expectation */
	exp: Expectation.Any

	/** The current State of the expectation. */
	state: ExpectedPackageStatusAPI.WorkStatusState
	/** Reason for the current state. */
	reason: Reason

	/** Previous reasons, for each state. */
	prevStatusReasons: { [status: string]: Reason }

	/** List of worker ids that have gotten the question wether they support this expectation */
	queriedWorkers: { [workerId: string]: number }
	/** List of worker ids that supports this Expectation */
	availableWorkers: { [workerId: string]: true }
	noAvailableWorkersReason: Reason
	/** Timestamp of the last time the expectation was evaluated. */
	lastEvaluationTime: number
	/** Timestamp to track how long the expectation has been waiting for a worker (can't start working), used to request more resources */
	waitingForWorkerTime: number | null
	/** Timestamp to track  how long the expectation has been waiting for a worker, used to restart to re-query for workers */
	noWorkerAssignedTime: number | null
	/** The number of times the expectation has failed */
	errorCount: number
	/** When set, contains info about the last error that happened on the expectation. */
	lastError: {
		/** Timestamp of the last error */
		time: number
		/** Explanation of what the last error was */
		reason: Reason
	} | null
	/** How many times the Expectation failed to be Removed */
	errorOnRemoveCount: number

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
export interface TrackedPackageContainerExpectation {
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

	/** Timestamp of the last time the cronjob was run */
	lastCronjobTime: number

	/** If the monitor is set up okay */
	monitorIsSetup: boolean

	/** These statuses are sent from the workers */
	status: ExpectedPackageStatusAPI.PackageContainerStatus

	/** Is set if the packageContainer has been removed */
	removed: boolean
}
export function expLabel(exp: TrackedExpectation): string {
	let id = `${exp.id}`
	if (id.length > 16) {
		id = id.slice(0, 8) + '...' + id.slice(-8)
	}

	return `${id} ${exp.exp.statusReport.label.slice(0, 50)}`
}
