import {
	HelpfulEventEmitter,
	LoggerInstance,
	Reason,
	StatusCode,
	PackageContainerId,
	MonitorId,
} from '@sofie-package-manager/api'
import { EvaluationScheduler } from './lib/evaluationScheduler'
import { ExpectationManagerCallbacks } from '../expectationManager'
import { ListeningExpectationsStorage } from './lib/listeningExpectationsStorage'
import { TrackedExpectationsStorage } from './lib/trackedExpectationsStorage'
import { TrackedPackageContainersStorage } from './lib/trackedPackageContainersStorage'
import { ExpectationTrackerConstants } from '../lib/constants'
import { WorkInProgressTracker } from './lib/workInProgressTracker'
import { TrackedReceivedUpdates } from './lib/trackedReceivedUpdates'
import { InternalManager } from '../internalManager/internalManager'
import { TrackedExpectation } from '../lib/trackedExpectation'
import { TrackedPackageContainerExpectation } from '../lib/trackedPackageContainerExpectation'
import { WorkerScaler } from './lib/workerScaler'
import { TrackedExpectationAPI } from './lib/trackedExpectationAPI'
import { TrackedPackageContainerAPI } from './lib/trackedPackageContainerAPI'
import { TrackedPackageContainerPackageAPI } from './lib/trackedPackageContainerPackageAPI'

/**
 * The ExpectationTracker is responsible for tracking and updating the state of the Expectations
 */
export class ExpectationTracker extends HelpfulEventEmitter {
	public constants: ExpectationTrackerConstants
	private scheduler: EvaluationScheduler

	/** Store for various incoming data, to be processed on next iteration round */
	public receivedUpdates: TrackedReceivedUpdates

	/** This is the main store of all Tracked Expectations */
	public trackedExpectations: TrackedExpectationsStorage

	public scaler: WorkerScaler

	public trackedPackageContainers: TrackedPackageContainersStorage

	public listeningExpectations: ListeningExpectationsStorage

	public worksInProgress: WorkInProgressTracker

	public trackedExpectationAPI: TrackedExpectationAPI
	public trackedPackageContainerAPI: TrackedPackageContainerAPI
	public trackedPackageContainerPackageAPI: TrackedPackageContainerPackageAPI

	private logger: LoggerInstance
	constructor(
		private manager: InternalManager,
		logger: LoggerInstance,
		constants: ExpectationTrackerConstants,
		public callbacks: ExpectationManagerCallbacks
	) {
		super()
		this.logger = logger.category('Tracker')
		this.constants = constants

		this.scheduler = new EvaluationScheduler(this.logger, this.manager, this)
		this.worksInProgress = new WorkInProgressTracker(this.logger, this)
		this.scaler = new WorkerScaler(this.logger, this.manager, this)

		this.listeningExpectations = new ListeningExpectationsStorage(this.logger, this)
		this.trackedExpectations = new TrackedExpectationsStorage(this)
		this.trackedPackageContainers = new TrackedPackageContainersStorage()

		this.trackedExpectationAPI = new TrackedExpectationAPI(this.logger, this)
		this.trackedPackageContainerAPI = new TrackedPackageContainerAPI(this)
		this.trackedPackageContainerPackageAPI = new TrackedPackageContainerPackageAPI(this)

		this.receivedUpdates = new TrackedReceivedUpdates()
	}
	public terminate(): void {
		this.scheduler.terminate()
	}
	public resetWork(): void {
		this.receivedUpdates.clear()
		this.trackedExpectations.clear()
		this.trackedPackageContainers.clear()

		this.scheduler.triggerEvaluation(true)
	}
	/**
	 * Set the scheduler to trigger another evaluation ASAP
	 */
	public triggerEvaluationNow(): void {
		this.scheduler.triggerEvaluation(true)
	}

	/** Returns the appropriate time to wait before checking a fulfilled expectation again */
	public getFulfilledWaitTime(): number {
		return (
			// Default minimum time to wait:
			this.constants.FULFILLED_MONITOR_TIME +
			// Also add some more time, so that we don't check too often when we have a lot of expectations:
			this.constants.FULFILLED_MONITOR_TIME_ADD_PER_EXPECTATION * this.trackedExpectations.getIds().length
		)
	}
	/** Called when there is a monitor-status-update from a worker */
	public async onMonitorStatus(
		packageContainerId: PackageContainerId,
		monitorId: MonitorId,
		status: StatusCode,
		reason: Reason
	): Promise<void> {
		const trackedPackageContainer = this.trackedPackageContainers.get(packageContainerId)
		if (!trackedPackageContainer) {
			this.logger.error(`Worker reported status on unknown packageContainer "${packageContainerId}"`)
			return
		}
		trackedPackageContainer.status.statusChanged = Date.now()

		this.trackedPackageContainerAPI.updateTrackedPackageContainerMonitorStatus(
			trackedPackageContainer,
			monitorId,
			undefined,
			status,
			reason
		)
	}
	public getTrackedPackageContainers(): TrackedPackageContainerExpectation[] {
		return this.trackedPackageContainers.list()
	}
	public getSortedTrackedExpectations(): TrackedExpectation[] {
		return this.trackedExpectations.list()
	}
}
