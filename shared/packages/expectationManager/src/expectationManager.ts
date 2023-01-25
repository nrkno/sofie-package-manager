// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import {
	ClientConnectionOptions,
	Expectation,
	ExpectationManagerWorkerAgent,
	LoggerInstance,
	LogLevel,
	PackageContainerExpectation,
	Reason,
	Statuses,
	Hook,
	WorkForceExpectationManager,
} from '@sofie-package-manager/api'
import { InternalManager } from './expectationManager/internalManager'
import { ExpectationTrackerConstants } from './lib/constants'

/**
 * The Expectation Manager is responsible for tracking the state of the Expectations,
 * and communicate with the Workers to progress them.
 * @see FOR_DEVELOPERS.md
 */
export class ExpectationManager {
	private internalManager: InternalManager
	constructor(
		logger: LoggerInstance,
		managerId: string,
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
		this.internalManager.workforceAPI.hook(hook)
	}
	get managerId(): string {
		return this.internalManager.managerId
	}

	/** Called when there is an updated set of PackageContainerExpectations. */
	updatePackageContainerExpectations(packageContainers: { [id: string]: PackageContainerExpectation }): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.internalManager.tracker.receivedUpdates.packageContainers = packageContainers
		this.internalManager.tracker.triggerEvaluateExpectationsNow()
	}
	/** Called when there is an updated set of Expectations. */
	updateExpectations(expectations: { [id: string]: Expectation.Any }): void {
		// We store the incoming expectations here, so that we don't modify anything in the middle of the _evaluateExpectations() iteration loop.
		this.internalManager.tracker.receivedUpdates.expectations = expectations

		this.internalManager.tracker.triggerEvaluateExpectationsNow()
	}
	/** Request that an Expectation is restarted. This functions returns immediately, not waiting for a result. */
	restartExpectation(expectationId: string): void {
		this.internalManager.tracker.receivedUpdates.restartExpectations[expectationId] = true
		this.internalManager.tracker.triggerEvaluateExpectationsNow()
	}
	/** Request that all Expectations are restarted. This functions returns immediately, not waiting for a result. */
	restartAllExpectations(): void {
		this.internalManager.tracker.receivedUpdates.restartAllExpectations = true
		this.internalManager.tracker.triggerEvaluateExpectationsNow()
	}
	/** Request that an Expectation is aborted.
	 * "Aborted" means that any current work is cancelled and any finished work will be removed.
	 * Any future attempts to check on the Expectation will be ignored.
	 * To un-Abort, call this.restartExpectation().
	 * This functions returns immediately, not waiting for a result. */
	abortExpectation(expectationId: string): void {
		this.internalManager.tracker.receivedUpdates.abortExpectations[expectationId] = true
		this.internalManager.tracker.triggerEvaluateExpectationsNow()
	}
	restartPackageContainer(containerId: string): void {
		this.internalManager.tracker.receivedUpdates.restartPackageContainers[containerId] = true

		this.internalManager.tracker.triggerEvaluateExpectationsNow()
	}
	/** Called by Workforce */
	async setLogLevel(logLevel: LogLevel): Promise<void> {
		await this.internalManager.setLogLevel(logLevel)
	}
	/** Called by Workforce*/
	async _debugKill(): Promise<void> {
		await this.internalManager._debugKill()
	}
	/** FOR DEBUGGING ONLY. Cut websocket connections, in order to ensure that they are restarted */
	async _debugSendKillConnections(): Promise<void> {
		await this.internalManager._debugSendKillConnections()
	}
	public getTroubleshootData(): any {
		return {
			trackedExpectations: this.internalManager.tracker.getSortedTrackedExpectations(),
			workers: this.internalManager.workerAgents.list(),
		}
	}
	async getStatusReport(): Promise<any> {
		return {
			workforce: this.internalManager.workforceAPI.connected
				? await this.internalManager.workforceAPI.getStatusReport()
				: {},
			expectationManager: this.internalManager.statusReport,
		}
	}
	async debugKillApp(appId: string): Promise<void> {
		return this.internalManager.workforceAPI._debugKillApp(appId)
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
	reportManagerStatus: (statuses: Statuses) => void
}
