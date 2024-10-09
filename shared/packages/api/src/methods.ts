/* eslint-disable @typescript-eslint/no-namespace */
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { Expectation } from './expectationApi'
import { PackageContainerExpectation } from './packageContainerApi'
import {
	Cost,
	ReturnTypeDisposePackageContainerMonitors,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	ReturnTypeRunPackageContainerCronJob,
	ReturnTypeSetupPackageContainerMonitors,
} from './worker'
import { WorkerStatusReport, WorkforceStatusReport } from './statusReport'
import { LogLevel } from './logger'
import { ExpectedPackage, StatusCode } from './inputApi'
import { Statuses } from './status'
import {
	AppContainerId,
	AppId,
	AppType,
	PackageContainerId,
	ExpectedPackageId,
	ExpectationManagerId,
	MonitorId,
	WorkerAgentId,
	WorkforceId,
	WorkInProgressLocalId,
} from './ids'
import { DataId, LockId } from './dataStorage'
import { PartyId } from './websocketConnection'

/** Contains textual descriptions for statuses. */
export type Reason = ExpectedPackageStatusAPI.Reason
/*
 * This file contains API definitions for the methods used to communicate between the Workforce, Worker and Expectation-Manager.
 */

export interface MethodsInterfaceBase {
	/** Id of the party that calls the methods */
	id: PartyId
}

/** Methods used by ExpectationManager and WorkForce */
export namespace WorkForceExpectationManager {
	/** Methods on WorkForce, called by ExpectationManager */
	export interface WorkForce extends MethodsInterfaceBase {
		id: ExpectationManagerId
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		setLogLevelOfApp: (appId: AppId, logLevel: LogLevel) => Promise<void>
		_debugKillApp(appId: AppId): Promise<void>
		_debugSendKillConnections(): Promise<void>
		getStatusReport: () => Promise<WorkforceStatusReport>

		requestResourcesForExpectation: (exp: Expectation.Any) => Promise<boolean>
		requestResourcesForPackageContainer: (packageContainer: PackageContainerExpectation) => Promise<boolean>

		registerExpectationManager: (managerId: ExpectationManagerId, url: string) => Promise<void>
	}
	/** Methods on ExpectationManager, called by WorkForce */
	// eslint-disable-next-line @typescript-eslint/no-empty-interface
	export interface ExpectationManager extends MethodsInterfaceBase {
		id: WorkforceId
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>
		_debugSendKillConnections: () => Promise<void>

		onWorkForceStatus: (statuses: Statuses) => Promise<void>
	}
}

/** Methods used by WorkForce and WorkerAgent */
export namespace WorkForceWorkerAgent {
	/** Methods on WorkerAgent, called by WorkForce */
	export interface WorkerAgent extends MethodsInterfaceBase {
		id: WorkforceId
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>
		_debugSendKillConnections: () => Promise<void>
		getStatusReport: () => Promise<WorkerStatusReport>

		expectationManagerAvailable: (id: ExpectationManagerId, url: string) => Promise<void>
		expectationManagerGone: (id: ExpectationManagerId) => Promise<void>
	}
	/** Methods on WorkForce, called by WorkerAgent */
	export interface WorkForce extends MethodsInterfaceBase {
		id: WorkerAgentId
		getExpectationManagerList: () => Promise<{ id: ExpectationManagerId; url: string }[]>
	}
}

/** Methods used by ExpectedManager and WorkerAgent */
export namespace ExpectationManagerWorkerAgent {
	/** Methods on WorkerAgent, called by ExpectedManager */
	export interface WorkerAgent extends MethodsInterfaceBase {
		id: ExpectationManagerId
		doYouSupportExpectation: (exp: Expectation.Any) => Promise<ReturnTypeDoYouSupportExpectation>
		getCostForExpectation: (exp: Expectation.Any) => Promise<ExpectationCost>
		isExpectationReadyToStartWorkingOn: (
			exp: Expectation.Any
		) => Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
		isExpectationFulfilled: (
			exp: Expectation.Any,
			wasFulfilled: boolean
		) => Promise<ReturnTypeIsExpectationFulfilled>
		workOnExpectation: (exp: Expectation.Any, cost: ExpectationCost, timeout: number) => Promise<WorkInProgressInfo>
		removeExpectation: (exp: Expectation.Any) => Promise<ReturnTypeRemoveExpectation>

		cancelWorkInProgress: (wipId: WorkInProgressLocalId) => Promise<void>

		// PackageContainer-related methods:
		doYouSupportPackageContainer: (
			packageContainer: PackageContainerExpectation
		) => Promise<ReturnTypeDoYouSupportPackageContainer>
		runPackageContainerCronJob: (
			packageContainer: PackageContainerExpectation
		) => Promise<ReturnTypeRunPackageContainerCronJob>
		setupPackageContainerMonitors: (
			packageContainer: PackageContainerExpectation
		) => Promise<ReturnTypeSetupPackageContainerMonitors>
		disposePackageContainerMonitors: (
			packageContainerId: PackageContainerId
		) => Promise<ReturnTypeDisposePackageContainerMonitors>
	}
	/** Methods on ExpectedManager, called by WorkerAgent */
	export interface ExpectationManager extends MethodsInterfaceBase {
		id: WorkerAgentId
		messageFromWorker: (message: MessageFromWorkerPayload.Any) => Promise<any>

		// Events emitted from a workInProgress:
		wipEventProgress: (
			wipId: WorkInProgressLocalId,
			actualVersionHash: string | null,
			progress: number
		) => Promise<void>
		wipEventDone: (
			wipId: WorkInProgressLocalId,
			actualVersionHash: string,
			reason: Reason,
			result: any
		) => Promise<void>
		wipEventError: (wipId: WorkInProgressLocalId, reason: Reason) => Promise<void>

		monitorStatus: (
			packageContainerId: PackageContainerId,
			monitorId: MonitorId,
			status: StatusCode,
			reason: Reason
		) => Promise<void>
	}
	export interface WorkInProgressInfo {
		wipId: WorkInProgressLocalId
		properties: WorkInProgressProperties
	}
	export interface WorkInProgressProperties {
		workLabel: string
		targetCanBeUsedWhileTransferring?: boolean
	}

	export interface ExpectationCost {
		/** Cost for working on the Expectation (null means "infinite cost") */
		cost: Cost
		/** Cost "in queue" until working on the Expectation can start */
		startCost: Cost
		reason: Reason
	}
	export type MessageFromWorker = (
		managerId: ExpectationManagerId,
		message: MessageFromWorkerPayload.Any
	) => Promise<any>
	export type MessageFromWorkerSerialized = (message: MessageFromWorkerPayload.Any) => Promise<ReplyToWorker>

	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace MessageFromWorkerPayload {
		export type Any = FetchPackageInfoMetadata | UpdatePackageInfo | RemovePackageInfo | ReportFromMonitorPackages
		export interface Base {
			type: string
			arguments: any[]
		}
		// Note: These interfaces are based on the methods exposed by Sofie Core
		export interface FetchPackageInfoMetadata extends Base {
			type: 'fetchPackageInfoMetadata'
			arguments: [
				//
				type: string,
				packageIds: ExpectedPackageId[]
			]
		}
		export interface UpdatePackageInfo extends Base {
			type: 'updatePackageInfo'
			arguments: [
				type: string,
				packageId: ExpectedPackageId,
				expectedContentVersionHash: string,
				actualContentVersionHash: string,
				payload: any
			]
		}
		export interface RemovePackageInfo extends Base {
			type: 'removePackageInfo'
			arguments: [
				//
				type: string,
				packageId: ExpectedPackageId,
				removeDelay: number | undefined
			]
		}
		export interface ReportFromMonitorPackages extends Base {
			type: 'reportFromMonitorPackages'
			arguments: [
				//
				containerId: PackageContainerId,
				monitorId: MonitorId,
				expectedPackages: ExpectedPackage.Any[]
			]
		}
	}

	export interface ReplyToWorker {
		error?: string
		result?: any
	}
}
/** Methods used by WorkForce and AppContainer */
export namespace WorkForceAppContainer {
	/** Methods on AppContainer, called by WorkForce */
	export interface AppContainer extends MethodsInterfaceBase {
		id: WorkforceId
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>
		_debugSendKillConnections: () => Promise<void>

		requestAppTypeForExpectation: (
			exp: Expectation.Any
		) => Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }>
		requestAppTypeForPackageContainer: (
			packageContainer: PackageContainerExpectation
		) => Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }>

		spinUp: (appType: AppType) => Promise<AppId>
		spinDown: (appId: AppId, reason: string) => Promise<void>
		getRunningApps: () => Promise<{ appId: AppId; appType: AppType }[]>
	}
	/** Methods on WorkForce, called by AppContainer */
	export interface WorkForce extends MethodsInterfaceBase {
		id: AppContainerId

		registerAvailableApps: (availableApps: { appType: AppType }[]) => Promise<void>
	}
}

/** Methods used by AppContainer and WorkerAgent */
export namespace AppContainerWorkerAgent {
	/** Methods on WorkerAgent, called by AppContainer */
	export interface WorkerAgent extends MethodsInterfaceBase {
		id: AppContainerId
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>

		doYouSupportExpectation: (exp: Expectation.Any) => Promise<ReturnTypeDoYouSupportExpectation>
		doYouSupportPackageContainer: (
			packageContainer: PackageContainerExpectation
		) => Promise<ReturnTypeDoYouSupportExpectation>
		setSpinDownTime: (spinDownTime: number) => Promise<void>
	}
	/** Methods on AppContainer, called by WorkerAgent */
	export interface AppContainer extends MethodsInterfaceBase {
		id: WorkerAgentId

		ping: () => Promise<void>
		requestSpinDown: (force?: boolean) => Promise<void>
		/** Acquire a write lock, the returned id is then used in workerStorageWrite to write */
		workerStorageWriteLock: (dataId: DataId, customTimeout?: number) => Promise<{ lockId: LockId; current: any }>
		workerStorageReleaseLock: (dataId: DataId, lockId: LockId) => Promise<void>
		workerStorageWrite: (dataId: DataId, lockId: LockId, data: string) => Promise<void>
		workerStorageRead: (dataId: DataId) => Promise<any>
	}
}
