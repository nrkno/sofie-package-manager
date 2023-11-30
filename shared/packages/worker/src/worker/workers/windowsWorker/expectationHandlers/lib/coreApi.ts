export enum PackageInfoType {
	Scan = 'scan',
	DeepScan = 'deepScan',
	Loudness = 'loudness',

	/** Unknown JSON data */
	JSON = 'json',
}

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

export interface LoudnessScanResult {
	channels: {
		[channelSpec: string]: LoudnessScanResultForStream
	}
}

export type LoudnessScanResultForStream =
	| {
			success: false
			reason: string
	  }
	| {
			success: true
			// Detected channel layout for the stream
			layout: string
			/** Unit: LUFS */
			integrated: number
			/** Unit: LUFS */
			integratedThreshold: number

			/** Unit: LU */
			range: number
			/** Unit: LUFS */
			rangeThreshold: number
			/** Unit: LUFS  */
			rangeLow: number
			/** Unit: LUFS */
			rangeHigh: number
			/** Unit: dBFS */
			truePeak: number
	  }
