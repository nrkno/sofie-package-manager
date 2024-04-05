// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import {
	ClientConnectionOptions,
	Expectation,
	ExpectationManagerWorkerAgent,
	LoggerInstance,
	PackageContainerExpectation,
	Reason,
	Statuses,
	Hook,
	WorkForceExpectationManager,
	ExpectationManagerId,
	PackageContainerId,
	ExpectationId,
	ExpectedPackageId,
	AppId,
	WorkerAgentId,
} from '@sofie-package-manager/api'
import { InternalManager } from './internalManager/internalManager'
import { ExpectationTrackerConstants } from './lib/constants'
import { mapToObject } from './lib/lib'

/**
 * The Expectation Manager is responsible for tracking the state of the Expectations,
 * and communicate with the Workers to progress them.
 * @see FOR_DEVELOPERS.md
 */
export class ExpectationManager {
	private internalManager: InternalManager
	constructor(
		logger: LoggerInstance,
		managerId: ExpectationManagerId,
		serverOptions: ExpectationManagerServerOptions,
		serverAccessBaseUrl: string | undefined,
		workForceConnectionOptions: ClientConnectionOptions,
		callbacks: ExpectationManagerCallbacks,
		options?: ExpectationManagerOptions
	) {
		this.internalManager = new InternalManager(
			logger,
			managerId,
			serverOptions,
			/** At what url the ExpectationManager can be reached on */
			serverAccessBaseUrl,
			workForceConnectionOptions,
			callbacks,
			options
		)
	}
	terminate(): void {
		this.internalManager.terminate()
	}
	async init(): Promise<void> {
		await this.internalManager.init()
	}
	/** Used to hook into methods of Workforce directly (this is done when the server and client runs in the same process). */
	hookToWorkforce(
		hook: Hook<WorkForceExpectationManager.WorkForce, WorkForceExpectationManager.ExpectationManager>
	): void {
		this.internalManager.workforceConnection.workforceAPI.hook(hook)
	}
	/** Returns a Hook used to hook up a WorkerAgent to our API-methods. */
	getWorkerAgentHook(): Hook<
		ExpectationManagerWorkerAgent.ExpectationManager,
		ExpectationManagerWorkerAgent.WorkerAgent
	> {
		return this.internalManager.getWorkerAgentHook()
	}
	removeWorkerAgentHook(clientId: WorkerAgentId): void {
		return this.internalManager.removeWorkerAgentHook(clientId)
	}
	resetWork(): void {
		this.internalManager.resetWork()
	}
	get managerId(): ExpectationManagerId {
		return this.internalManager.managerId
	}

	/** Called when there is an updated set of PackageContainerExpectations. */
	updatePackageContainerExpectations(
		packageContainers: Record<PackageContainerId, PackageContainerExpectation>
	): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.internalManager.tracker.receivedUpdates.setPackageContainers(packageContainers)
		this.internalManager.tracker.triggerEvaluationNow()
	}
	/** Called when there is an updated set of Expectations. */
	updateExpectations(expectations: Record<ExpectationId, Expectation.Any>): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.internalManager.tracker.receivedUpdates.setExpectations(expectations)

		this.internalManager.tracker.triggerEvaluationNow()
	}
	/** Request that an Expectation is restarted. This functions returns immediately, not waiting for a result. */
	restartExpectation(expectationId: ExpectationId): void {
		this.internalManager.tracker.receivedUpdates.restartExpectations(expectationId)
		this.internalManager.tracker.triggerEvaluationNow()
	}
	/** Request that all Expectations are restarted. This functions returns immediately, not waiting for a result. */
	restartAllExpectations(): void {
		this.internalManager.tracker.receivedUpdates.restartAllExpectations = true
		this.internalManager.tracker.triggerEvaluationNow()
	}
	/** Request that an Expectation is aborted.
	 * "Aborted" means that any current work is cancelled and any finished work will be removed.
	 * Any future attempts to check on the Expectation will be ignored.
	 * To un-Abort, call this.restartExpectation().
	 * This functions returns immediately, not waiting for a result. */
	abortExpectation(expectationId: ExpectationId): void {
		this.internalManager.tracker.receivedUpdates.abortExpectations(expectationId)
		this.internalManager.tracker.triggerEvaluationNow()
	}
	restartPackageContainer(containerId: PackageContainerId): void {
		this.internalManager.tracker.receivedUpdates.restartPackageContainers(containerId)

		this.internalManager.tracker.triggerEvaluationNow()
	}
	public getTroubleshootData(): any {
		const trackedExpectations = this.internalManager.tracker.getSortedTrackedExpectations().map((trackedExp) => {
			return {
				...trackedExp,
				// Convert Sets and Maps so that they are serializable:
				availableWorkers: Array.from(trackedExp.availableWorkers.keys()),
				queriedWorkers: mapToObject(trackedExp.queriedWorkers),
			}
		})
		return {
			trackedExpectations,
			workers: this.internalManager.workerAgents.list(),
			waitingExpectations: this.internalManager.tracker.scaler.getWaitingExpectationIds(),
		}
	}
	async getStatusReport(): Promise<any> {
		return {
			workforce: this.internalManager.workforceConnection.workforceAPI.connected
				? await this.internalManager.workforceConnection.workforceAPI.getStatusReport()
				: {},
			expectationManager: this.internalManager.statusReport.get(),
		}
	}
	async debugKillApp(appId: AppId): Promise<void> {
		return this.internalManager.workforceConnection.workforceAPI._debugKillApp(appId)
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
		expectationId: ExpectationId,
		expectation: Expectation.Any | null,
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
		containerId: PackageContainerId,
		packageId: ExpectedPackageId,
		packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
	) => void
	reportPackageContainerExpectationStatus: (
		containerId: PackageContainerId,
		statusInfo: ExpectedPackageStatusAPI.PackageContainerStatus | null
	) => void
	messageFromWorker: MessageFromWorker
	reportManagerStatus: (statuses: Statuses) => void
}
