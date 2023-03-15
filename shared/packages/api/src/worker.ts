/*
 * This file contains API definitions for the Worker methods
 */

import { Reason } from './methods'

export type ReturnTypeDoYouSupportExpectation =
	| {
			support: true
	  }
	| {
			support: false
			reason: Reason
	  }
export type ReturnTypeGetCostFortExpectation = {
	cost: number
	reason: Reason
}
export type ReturnTypeIsExpectationReadyToStartWorkingOn =
	| {
			ready: true
	  }
	| {
			ready: false
			/**
			 * true indicates that a source exists,
			 * false indicates that a source does not exist,
			 * undefined means unknown
			 */
			sourceExists?: boolean
			isWaitingForAnother?: boolean
			reason: Reason
	  }
export type ReturnTypeIsExpectationFullfilled =
	| {
			fulfilled: true
	  }
	| {
			fulfilled: false
			reason: Reason
	  }
export type ReturnTypeRemoveExpectation =
	| {
			removed: true
	  }
	| {
			removed: false
			reason: Reason
	  }

/** Configurations for any of the workers */
export interface WorkerAgentConfig {
	workerId: string
	/**
	 * The time to wait when determining if the source package is stable or not (this is used to wait for growing files)
	 * Set to 0 to disable the stability check.
	 * Default: 4000 ms
	 */
	sourcePackageStabilityThreshold?: number

	/**
	 * A list of which drive letters a Windows-worker can use to map network shares onto.
	 * A mapped network share increases performance in various ways, compared to accessing the network share directly.
	 * Example: ['X', 'Y', 'Z']
	 */
	windowsDriveLetters?: string[]
}
export type ReturnTypeDoYouSupportPackageContainer =
	| {
			support: true
	  }
	| {
			support: false
			reason: Reason
	  }
export type ReturnTypeRunPackageContainerCronJob =
	| {
			success: true
	  }
	| {
			success: false
			reason: Reason
	  }
export type ReturnTypeDisposePackageContainerMonitors =
	| {
			success: true
	  }
	| {
			success: false
			reason: Reason
	  }
export type ReturnTypeSetupPackageContainerMonitors =
	| {
			success: true
			monitors: { [monitorId: string]: MonitorProperties }
	  }
	| {
			success: false
			reason: Reason
	  }
export interface MonitorProperties {
	label: string
}
