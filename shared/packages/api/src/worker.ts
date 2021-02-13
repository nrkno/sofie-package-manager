export interface ReturnTypeDoYouSupportExpectation {
	support: boolean
	reason: string
}
export type ReturnTypeGetCostFortExpectation = number
export interface ReturnTypeIsExpectationReadyToStartWorkingOn {
	ready: boolean
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
