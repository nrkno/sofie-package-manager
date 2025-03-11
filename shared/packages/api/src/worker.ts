/*
 * This file contains API definitions for the Worker methods
 */

import { MonitorId, WorkerAgentId } from './ids'
import { Reason } from './methods'

export type ReturnTypeDoYouSupportExpectation =
	| {
			support: true
	  }
	| {
			support: false
			reason: Reason
			knownReason: KnownReason
	  }
export type ReturnTypeGetCostFortExpectation = {
	/** (null means "infinite cost") */
	cost: Cost
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
			isPlaceholder?: boolean
			reason: Reason
			knownReason: KnownReason
	  }
export type ReturnTypeIsExpectationFulfilled =
	| {
			fulfilled: true
	  }
	| {
			fulfilled: false
			reason: Reason
			knownReason: KnownReason
	  }
export type ReturnTypeRemoveExpectation =
	| {
			removed: true
	  }
	| {
			removed: false
			reason: Reason
			knownReason: KnownReason
	  }

/** Configurations for any of the workers */
export interface WorkerAgentConfig {
	workerId: WorkerAgentId
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
			knownReason: KnownReason
	  }
export type ReturnTypeRunPackageContainerCronJob =
	| {
			success: true
	  }
	| {
			success: false
			reason: Reason
			knownReason: KnownReason
	  }
export type ReturnTypeDisposePackageContainerMonitors =
	| {
			success: true
	  }
	| {
			success: false
			reason: Reason
			knownReason: KnownReason
	  }
export type ReturnTypeSetupPackageContainerMonitors =
	| {
			success: true
			monitors: Record<MonitorId, MonitorProperties>
	  }
	| {
			success: false
			reason: Reason
			knownReason: KnownReason
	  }
export interface MonitorProperties {
	label: string
}

/** A numeric value representing the effort needed to work on something (null means "infinitely high cost"). */
export type Cost = number | null // Note: we're using null to represent infinity because Number.Infinity is not JSON-serializable
/** Converts Cost into a numeric value, that can be used to compare different costs to each other */
export function valueOfCost(cost: Cost): number {
	return cost === null ? Number.POSITIVE_INFINITY : cost
}

/**
 * This represents a flag that indicates if the reason for being unsuccessful is well known.
 * - It should be set to true if the reason for being unsuccessful is well known.
 * - If should be set to if there is a chance that the error has an unknown/external origin.
 *   If this happens enough times, a worker might eventually be restarted to try to solve the issue
 * @see config.worker.failurePeriod.
 * @see config.worker.failurePeriodLimit.
 * */
export type KnownReason = boolean
