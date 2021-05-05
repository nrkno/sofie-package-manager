export interface DeepScanResult {
	field_order: FieldOrder
	blacks: ScanAnomaly[]
	freezes: ScanAnomaly[]
	scenes: number[]
}

export enum FieldOrder {
	Unknown = 'unknown',
	Progressive = 'progressive',
	TFF = 'tff',
	BFF = 'bff',
}
export interface ScanAnomaly {
	start: number
	duration: number
	end: number
}
