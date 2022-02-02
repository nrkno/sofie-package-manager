/* eslint-disable @typescript-eslint/no-namespace */
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { Expectation } from './expectationApi'
import { PackageContainerExpectation } from './packageContainerApi'
import {
	ReturnTypeDisposePackageContainerMonitors,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	ReturnTypeRunPackageContainerCronJob,
	ReturnTypeSetupPackageContainerMonitors,
} from './worker'
import { WorkerStatus, WorkforceStatus } from './status'
import { LogLevel } from './logger'
import { ExpectedPackage, StatusCode } from './inputApi'

/** Contains textual descriptions for statuses. */
export type Reason = ExpectedPackageStatusAPI.Reason
/*
 * This file contains API definitions for the methods used to communicate between the Workforce, Worker and Expectation-Manager.
 */

/** Methods used by ExpectationManager and WorkForce */
export namespace WorkForceExpectationManager {
	/** Methods on WorkForce, called by ExpectationManager */
	export interface WorkForce {
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		setLogLevelOfApp: (appId: string, logLevel: LogLevel) => Promise<void>
		_debugKillApp(appId: string): Promise<void>
		getStatus: () => Promise<WorkforceStatus>

		requestResourcesForExpectation: (exp: Expectation.Any) => Promise<boolean>
		requestResourcesForPackageContainer: (packageContainer: PackageContainerExpectation) => Promise<boolean>

		registerExpectationManager: (managerId: string, url: string) => Promise<void>
	}
	/** Methods on ExpectationManager, called by WorkForce */
	// eslint-disable-next-line @typescript-eslint/no-empty-interface
	export interface ExpectationManager {
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>
	}
}

/** Methods used by WorkForce and WorkerAgent */
export namespace WorkForceWorkerAgent {
	/** Methods on WorkerAgent, called by WorkForce */
	export interface WorkerAgent {
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>
		getStatus: () => Promise<WorkerStatus>

		expectationManagerAvailable: (id: string, url: string) => Promise<void>
		expectationManagerGone: (id: string) => Promise<void>
	}
	/** Methods on WorkForce, called by WorkerAgent */
	export interface WorkForce {
		getExpectationManagerList: () => Promise<{ id: string; url: string }[]>
	}
}

/** Methods used by ExpectedManager and WorkerAgent */
export namespace ExpectationManagerWorkerAgent {
	/** Methods on WorkerAgent, called by ExpectedManager */
	export interface WorkerAgent {
		doYouSupportExpectation: (exp: Expectation.Any) => Promise<ReturnTypeDoYouSupportExpectation>
		getCostForExpectation: (exp: Expectation.Any) => Promise<ExpectationCost>
		isExpectationReadyToStartWorkingOn: (
			exp: Expectation.Any
		) => Promise<ReturnTypeIsExpectationReadyToStartWorkingOn>
		isExpectationFullfilled: (
			exp: Expectation.Any,
			wasFullfilled: boolean
		) => Promise<ReturnTypeIsExpectationFullfilled>
		workOnExpectation: (exp: Expectation.Any, cost: ExpectationCost, timeout: number) => Promise<WorkInProgressInfo>
		removeExpectation: (exp: Expectation.Any) => Promise<ReturnTypeRemoveExpectation>

		cancelWorkInProgress: (wipId: number) => Promise<void>

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
			packageContainerId: string
		) => Promise<ReturnTypeDisposePackageContainerMonitors>
	}
	/** Methods on ExpectedManager, called by WorkerAgent */
	export interface ExpectationManager {
		messageFromWorker: (message: MessageFromWorkerPayload.Any) => Promise<any>

		// Events emitted from a workInProgress:
		wipEventProgress: (wipId: number, actualVersionHash: string | null, progress: number) => Promise<void>
		wipEventDone: (wipId: number, actualVersionHash: string, reason: Reason, result: any) => Promise<void>
		wipEventError: (wipId: number, reason: Reason) => Promise<void>

		monitorStatus: (
			packageContainerId: string,
			monitorId: string,
			status: StatusCode,
			reason: Reason
		) => Promise<void>
	}
	export interface WorkInProgressInfo {
		wipId: number
		properties: WorkInProgressProperties
	}
	export interface WorkInProgressProperties {
		workLabel: string
		targetCanBeUsedWhileTransferring?: boolean
	}

	export interface ExpectationCost {
		/** Cost for working on the Expectation */
		cost: number
		/** Cost "in queue" until working on the Expectation can start */
		startCost: number
	}
	export type MessageFromWorker = (managerId: string, message: MessageFromWorkerPayload.Any) => Promise<any>
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
				string, // type
				string[] // packageIds
			]
		}
		export interface UpdatePackageInfo extends Base {
			type: 'updatePackageInfo'
			arguments: [
				string, // type
				string, // packageId
				string, // expectedContentVersionHash
				string, // actualContentVersionHash
				any // payload
			]
		}
		export interface RemovePackageInfo extends Base {
			type: 'removePackageInfo'
			arguments: [
				string, // type
				string, // packageId
				number | undefined // removeDelay
			]
		}
		export interface ReportFromMonitorPackages extends Base {
			type: 'reportFromMonitorPackages'
			arguments: [
				string, // containerId
				string, // monitorId
				ExpectedPackage.Any[] // expectedPackages
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
	export interface AppContainer {
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>

		requestAppTypeForExpectation: (
			exp: Expectation.Any
		) => Promise<{ success: true; appType: string; cost: number } | { success: false; reason: Reason }>
		requestAppTypeForPackageContainer: (
			packageContainer: PackageContainerExpectation
		) => Promise<{ success: true; appType: string; cost: number } | { success: false; reason: Reason }>

		spinUp: (
			appType: 'worker' // | other
		) => Promise<string>
		spinDown: (appId: string, reason: string) => Promise<void>
		getRunningApps: () => Promise<{ appId: string; appType: string }[]>
	}
	/** Methods on WorkForce, called by AppContainer */
	export interface WorkForce {
		registerAvailableApps: (availableApps: { appType: string }[]) => Promise<void>
	}
}

/** Methods used by AppContainer and WorkerAgent */
export namespace AppContainerWorkerAgent {
	/** Methods on WorkerAgent, called by AppContainer */
	export interface WorkerAgent {
		setLogLevel: (logLevel: LogLevel) => Promise<void>
		_debugKill: () => Promise<void>

		doYouSupportExpectation: (exp: Expectation.Any) => Promise<ReturnTypeDoYouSupportExpectation>
		doYouSupportPackageContainer: (
			packageContainer: PackageContainerExpectation
		) => Promise<ReturnTypeDoYouSupportExpectation>
		setSpinDownTime: (spinDownTime: number) => Promise<void>
	}
	/** Methods on AppContainer, called by WorkerAgent */
	export interface AppContainer {
		ping: () => Promise<void>
		requestSpinDown: () => Promise<void>
	}
}
