import { ExpectedPackageWrap } from '../../packageManager'
import { ExpectedPackage, Expectation } from '@shared/api'

export type GenerateExpectation = Expectation.Base & {
	sideEffect?: ExpectedPackage.Base['sideEffect']
	external?: boolean
}

export interface ExpectedPackageWrapMediaFile extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageMediaFile
	sources: {
		containerId: string
		label: string
		accessors: NonNullable<ExpectedPackage.ExpectedPackageMediaFile['sources'][0]['accessors']>
	}[]
}
export interface ExpectedPackageWrapQuantel extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageQuantelClip
	sources: {
		containerId: string
		label: string
		accessors: NonNullable<ExpectedPackage.ExpectedPackageQuantelClip['sources'][0]['accessors']>
	}[]
}
export interface ExpectedPackageWrapJSONData extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageJSONData
	sources: {
		containerId: string
		label: string
		accessors: NonNullable<ExpectedPackage.ExpectedPackageJSONData['sources'][0]['accessors']>
	}[]
}

/*
Notes on priorities:

The ExpectedPackages have an initial priority from Core, it'll have some values like:
	0 = Currently playing part
	1 = Next part
	9 = Others
*/

/** The priority values on the resulting Expectations are divided into these magnitudes: */
export enum PriorityMagnitude {
	/** 0: Things that are to be played out like RIGHT NOW */
	PLAY_NOW = 0,
	/** 10: Things that are to be played out PRETTY SOON (things that could be cued anytime now) */
	PLAY_SOON = 10,
	/** 100: Things that affect users (GUI things) that are IMPORTANT */
	GUI_IMPORTANT = 100,
	/** 1000: Things that affect users (GUI things) that are NICE TO HAVE */
	GUI_OTHER = 1000,
	/** 10000+: Other */
	OTHER = 10000,
}
/** The priority values to-be-added to the different expectation types: */
export enum PriorityAdditions {
	COPY = 0,
	SCAN = 100,
	DEEP_SCAN = 1001,
	THUMBNAIL = 1002,
	PREVIEW = 1003,
}
