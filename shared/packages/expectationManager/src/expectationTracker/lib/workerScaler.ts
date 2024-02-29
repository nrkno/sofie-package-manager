// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { LoggerInstance } from '@sofie-package-manager/api'
import { InternalManager } from '../../internalManager/internalManager'
import { expLabel, TrackedExpectation } from '../../lib/trackedExpectation'
import { TrackedPackageContainerExpectation } from '../../lib/trackedPackageContainerExpectation'
import { ExpectationTracker } from '../expectationTracker'

/** Handles scaling of Workers */
export class WorkerScaler {
	private waitingExpectations: TrackedExpectation[] = []
	private waitingPackageContainers: TrackedPackageContainerExpectation[] = []

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private manager: InternalManager, private tracker: ExpectationTracker) {
		this.logger = logger.category('WorkerScaler')
		this.waitingExpectations = []
	}

	/**
	 * Goes through the expectations and checks if there are too many expectations waiting for workers
	 * and tries to scale up new workers if needed.
	 * Called when a pass of evaluating expectation has finished
	 */
	public async checkIfNeedToScaleUp(): Promise<void> {
		this.updateWaitingExpectations()

		let requestsSentCount = 0
		for (const exp of this.waitingExpectations) {
			if (requestsSentCount < this.tracker.constants.SCALE_UP_COUNT) {
				requestsSentCount++
				this.logger.debug(`Requesting more resources to handle expectation "${expLabel(exp)}"`)
				await this.manager.workforceConnection.workforceAPI.requestResourcesForExpectation(exp.exp)
			}
		}

		this.logger.silly(
			`Waiting expectations: ${this.getWaitingExpectationCount()}, sent out ${requestsSentCount} requests`
		)

		this.updateWaitingPackageContainers()

		for (const packageContainer of this.waitingPackageContainers) {
			if (requestsSentCount < this.tracker.constants.SCALE_UP_COUNT) {
				requestsSentCount++
				this.logger.debug(`Requesting more resources to handle packageContainer "${packageContainer.id}"`)
				await this.manager.workforceConnection.workforceAPI.requestResourcesForPackageContainer(
					packageContainer.packageContainer
				)
			}
		}
	}
	public getWaitingExpectationCount(): number {
		return this.waitingExpectations.length
	}
	private updateWaitingExpectations(): void {
		this.waitingExpectations = []

		for (const exp of this.tracker.trackedExpectations.list()) {
			/** The expectation is waiting on another expectation */
			const isWaitingForOther = this.tracker.trackedExpectationAPI.isExpectationWaitingForOther(exp)

			/** The expectation is waiting for a worker */
			const isWaiting: boolean =
				exp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW ||
				exp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING ||
				exp.state === ExpectedPackageStatusAPI.WorkStatusState.READY

			/** Not supported by any worker */
			const notSupportedByAnyWorker = exp.availableWorkers.size === 0

			/** No worker has had time to work on it lately */
			const notAssignedToAnyWorkerForSomeTime: boolean =
				!!exp.noWorkerAssignedTime &&
				Date.now() - exp.noWorkerAssignedTime > this.tracker.constants.SCALE_UP_TIME

			// Is the expectation waiting for resources?
			if (!isWaitingForOther && (isWaiting || notSupportedByAnyWorker || notAssignedToAnyWorkerForSomeTime)) {
				// Add a second round of waiting, to ensure that we don't scale up prematurely:
				if (!exp.waitingForWorkerTime) {
					this.logger.silly(
						`Starting to track how long expectation "${expLabel(exp)}" has been waiting for a worker`
					)
					exp.waitingForWorkerTime = Date.now()
				}
			} else {
				exp.waitingForWorkerTime = null
			}

			// If the expectation has been waiting for long enough:
			if (exp.waitingForWorkerTime) {
				const hasBeenWaitingFor = Date.now() - exp.waitingForWorkerTime
				if (
					hasBeenWaitingFor > this.tracker.constants.SCALE_UP_TIME || // Don't scale up too fast
					this.manager.workerAgents.list().length === 0 // Although if there are no workers connected, we should scale up right away
				) {
					this.waitingExpectations.push(exp)
				} else {
					this.logger.silly(
						`Expectation "${expLabel(exp)}" has been waiting for less than ${
							this.tracker.constants.SCALE_UP_TIME
						}ms (${hasBeenWaitingFor}ms), letting it wait a bit more`
					)
				}
			}
		}
	}
	private updateWaitingPackageContainers(): void {
		this.waitingPackageContainers = []
		for (const packageContainer of this.tracker.getTrackedPackageContainers()) {
			if (!packageContainer.currentWorker) {
				if (!packageContainer.waitingForWorkerTime) {
					packageContainer.waitingForWorkerTime = Date.now()
				}
			} else {
				packageContainer.waitingForWorkerTime = null
			}
			if (
				packageContainer.waitingForWorkerTime &&
				Date.now() - packageContainer.waitingForWorkerTime > this.tracker.constants.SCALE_UP_TIME
			) {
				this.waitingPackageContainers.push(packageContainer)
			}
		}
	}
}
