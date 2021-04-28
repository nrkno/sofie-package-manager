export interface ReturnTypeDoYouSupportExpectation {
	support: boolean
	reason: string
}
export type ReturnTypeGetCostFortExpectation = number
export interface ReturnTypeIsExpectationReadyToStartWorkingOn {
	ready: boolean
	sourceExists?: boolean
	reason?: string
}
export interface ReturnTypeIsExpectationFullfilled {
	fulfilled: boolean
	reason?: string
}
export interface ReturnTypeRemoveExpectation {
	removed: boolean
	reason?: string
}

/** Configurations for any of the workers */
export interface WorkerAgentConfig {
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
export interface ReturnTypeDoYouSupportPackageContainer {
	support: boolean
	reason: string
}
export interface ReturnTypeRunPackageContainerCronJob {
	completed: boolean
	reason?: string
}
export interface ReturnTypeDisposePackageContainerMonitors {
	disposed: boolean
	reason?: string
}
export interface ReturnTypeSetupPackageContainerMonitors {
	setupOk: boolean
	reason?: string
	monitors?: { [monitorId: string]: MonitorProperties }
}
export interface MonitorProperties {
	label: string
}
