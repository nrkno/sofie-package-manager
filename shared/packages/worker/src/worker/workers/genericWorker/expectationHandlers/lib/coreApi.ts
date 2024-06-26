export enum PackageInfoType {
	Scan = 'scan',
	DeepScan = 'deepScan',
	Loudness = 'loudness',
	Iframes = 'iframes',

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

			/**
			 * If a sum of the stereo channels has lower loudness than one of the channels, then the pair is not in phase.
			 * This is the loudness of one of the channels, subtracted from the integrated loudness of the sum
			 *
			 * Unit: LU
			 *
			 * This will only be calculated if "layout" is "stereo"
			 */
			inPhaseDifference?: number

			/**
			 * If one of the channels is louder than the other, then the pair is not balanced.
			 * This is the loudness of one of the channels, subtracted from the integrated loudness of the other.
			 *
			 * Unit: LU
			 *
			 * This will only be calculated if "layout" is "stereo"
			 * */
			balanceDifference?: number
	  }

export enum CompressionType {
	/** Undetected */
	Unknown = 'unknown',
	/** Every frame is a I-frame */
	AllIntra = 'all_intra',
	/** All I-frame are spaced evenly */
	FixedDistance = 'fixed_distance',
	/** I-frame distances vary */
	VariableDistance = 'variable_distance',
}

export type IframesScanResult =
	| {
			type: CompressionType.Unknown
	  }
	| {
			type: CompressionType.AllIntra
	  }
	| {
			type: CompressionType.FixedDistance
			/** Distance between I-frames, expressed in seconds */
			distance: number
	  }
	| {
			type: CompressionType.VariableDistance
			/** Frame times of I-frames in seconds */
			iframeTimes: number[]
	  }
