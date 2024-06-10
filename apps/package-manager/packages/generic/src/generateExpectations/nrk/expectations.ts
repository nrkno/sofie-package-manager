import { ExpectedPackageWrap, PackageContainers } from '../../packageManager'
import { PackageManagerSettings } from '../../generated/options'
import {
	ExpectedPackage,
	PackageContainer,
	Expectation,
	hashObj,
	LoggerInstance,
	ExpectationManagerId,
	ExpectationId,
	objectEntries,
	objectValues,
	objectSize,
} from '@sofie-package-manager/api'
import { GenerateExpectation, PriorityMagnitude } from './types'

import {
	generateMediaFileCopy,
	generateMediaFileVerify,
	generateQuantelCopy,
	generatePackageScan,
	generatePackageDeepScan,
	generateMediaFileThumbnail,
	generateMediaFilePreview,
	generateQuantelClipThumbnail,
	generateQuantelClipPreview,
	generateJsonDataCopy,
	generatePackageCopyFileProxy,
	generatePackageLoudness,
	generatePackageIframes,
} from './expectations-lib'
import { getSmartbullExpectedPackages, shouldBeIgnored } from './smartbull'
import { TEMPORARY_STORAGE_ID } from './lib'
import {
	PackageManagerActivePlaylist,
	PackageManagerActiveRundown,
	// eslint-disable-next-line node/no-extraneous-import
} from '@sofie-automation/shared-lib/dist/package-manager/publications'
// eslint-disable-next-line node/no-extraneous-import
import { RundownId } from '@sofie-automation/shared-lib/dist/core/model/Ids'

/** Generate and return the appropriate Expectations based on the provided expectedPackages */
export function getExpectations(
	logger: LoggerInstance,
	managerId: ExpectationManagerId,
	packageContainers: PackageContainers,
	_activePlaylist: PackageManagerActivePlaylist | null,
	activeRundowns: PackageManagerActiveRundown[],
	expectedPackages: ExpectedPackageWrap[],
	settings: PackageManagerSettings
): Record<ExpectationId, Expectation.Any> {
	const expectations: ExpectationCollection = {}

	// Note: All of this is a preliminary implementation!
	// A blueprint-like plug-in architecture might be a future idea

	/** If set, we should first copy media to a temporary storage and use that for side-effects  */
	const useTemporaryStorage = packageContainers[TEMPORARY_STORAGE_ID]

	// Sort, so that we handle the high-priority first:
	expectedPackages.sort((a, b) => {
		// Lowest first: (lower is better)
		if (a.priority > b.priority) return 1
		if (a.priority < b.priority) return -1
		return 0
	})
	// Prepare:
	const activeRundownMap = new Map<RundownId, PackageManagerActiveRundown>()
	for (const activeRundown of activeRundowns) {
		activeRundownMap.set(activeRundown._id, activeRundown)
	}

	// Add the basic expectations:
	for (const { packageWrap, exp } of getBasicExpectations(logger, managerId, expectedPackages, settings)) {
		addExpectation(logger, activeRundownMap, expectations, packageWrap, exp)
	}
	// Add expectations for Smartbull:
	for (const newPackage of getSmartbullExpectedPackages(logger, expectedPackages)) {
		const exp = generateMediaFileCopy(managerId, newPackage, settings)
		if (exp) {
			// @ts-expect-error hack
			exp.__isSmartbull = true
			addExpectation(logger, activeRundownMap, expectations, newPackage, exp)
		}
	}

	// Add side-effects from the initial expectations:
	injectSideEffectExpectations(logger, packageContainers, settings, expectations, useTemporaryStorage)

	const returnExpectations: ExpectationCollection = {}
	for (const [id, exp] of objectEntries(expectations)) {
		returnExpectations[id] = exp
	}
	return returnExpectations
}
/** Generate and return the most basic expectations based on the provided expectedPackages */
function getBasicExpectations(
	_logger: LoggerInstance,
	managerId: ExpectationManagerId,
	expectedPackages: ExpectedPackageWrap[],
	settings: PackageManagerSettings
) {
	const results: {
		packageWrap: ExpectedPackageWrap
		exp: Expectation.Any
	}[] = []
	for (const packageWrap of expectedPackages) {
		let exp: Expectation.Any | undefined = undefined

		// Ignore smartbull packages:
		if (shouldBeIgnored(packageWrap)) continue

		// Verify that the expectedPackage has any source and target accessors:
		const hasAnySourceAccessors = !!packageWrap.sources.find((source) => objectSize(source.accessors) > 0)
		const hasAnyTargetAccessors = !!packageWrap.targets.find((target) => objectSize(target.accessors) > 0)

		// No need to generate an expectation if there are no accessors:
		if (hasAnySourceAccessors || hasAnyTargetAccessors) {
			if (packageWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
				if (packageWrap.sources.length === 0) {
					// If there are no sources defined, just verify that the file exists on the target:
					exp = generateMediaFileVerify(managerId, packageWrap, settings)
				} else {
					exp = generateMediaFileCopy(managerId, packageWrap, settings)
				}
			} else if (packageWrap.expectedPackage.type === ExpectedPackage.PackageType.QUANTEL_CLIP) {
				exp = generateQuantelCopy(managerId, packageWrap)
			} else if (packageWrap.expectedPackage.type === ExpectedPackage.PackageType.JSON_DATA) {
				exp = generateJsonDataCopy(managerId, packageWrap, settings)
			}
			if (exp) {
				results.push({
					packageWrap,
					exp,
				})
			}
		}
	}
	return results
}

/** Based on existing expectations, inject more expectations as side-effects */
function injectSideEffectExpectations(
	_logger: LoggerInstance,
	packageContainers: PackageContainers,
	settings: PackageManagerSettings,
	expectations: ExpectationCollection,
	useTemporaryStorage: PackageContainer | undefined
): void {
	if (!useTemporaryStorage) {
		for (const expectation of groupExpectations(expectations)) {
			// Get side-effects and add them to the expectations:
			copyExpectationCollection(
				expectations,
				getSideEffectOfExpectation(_logger, packageContainers, settings, expectation)
			)
		}
	} else {
		const temporaryStorageExpectations: ExpectationCollection = {}
		for (const expectation0 of groupExpectations(expectations)) {
			// We need to copy the expectation to a temporary storage,
			// get those expectations and put them in temporaryStorageExpectations:
			copyExpectationCollection(
				temporaryStorageExpectations,
				getCopyToTemporaryStorage(_logger, useTemporaryStorage, settings, expectation0)
			)
		}

		// Okay, now let's generate the side-effects from the temporaryStorageExpectations instead:
		for (const [id, expectation] of objectEntries(temporaryStorageExpectations)) {
			// get side-effects:
			const resultingExpectations: ExpectationCollection = getSideEffectOfExpectation(
				_logger,
				packageContainers,
				settings,
				expectation
			)
			if (objectSize(resultingExpectations) > 0) {
				// Add the CopyToTemporaryStorage expectation:
				expectations[id] = expectation

				copyExpectationCollection(expectations, resultingExpectations)
			}
		}
	}
}

/** Group / Filter expectations into single ones, if they stem from the same original package */
function groupExpectations(expectations: ExpectationCollection): GenerateExpectation[] {
	// If there are multiple expectations for the same original
	// package we should only handle the side effects once:

	const groupedExpectations: GenerateExpectation[] = []

	const handledSources = new Set<string>()
	for (const expectation of objectValues(expectations)) {
		let alreadyHandled = false
		for (const fromPackage of expectation.fromPackages) {
			const key = hashObj(fromPackage)
			if (handledSources.has(key)) {
				alreadyHandled = true
			}
		}
		for (const fromPackage of expectation.fromPackages) {
			const key = hashObj(fromPackage)
			handledSources.add(key)
		}
		if (!alreadyHandled) {
			groupedExpectations.push(expectation)
		}
	}
	return groupedExpectations
}
/** Returns side-effects for an expectation */
function getSideEffectOfExpectation(
	_logger: LoggerInstance,
	packageContainers: PackageContainers,
	settings: PackageManagerSettings,
	expectation0: GenerateExpectation
): ExpectationCollection {
	const expectations: ExpectationCollection = {}
	if (
		expectation0.type === Expectation.Type.FILE_COPY ||
		expectation0.type === Expectation.Type.FILE_VERIFY ||
		expectation0.type === Expectation.Type.FILE_COPY_PROXY
	) {
		const expectation = expectation0

		if (!expectation0.external) {
			// All files that have been copied should also be scanned:
			if (
				expectation.type === Expectation.Type.FILE_COPY_PROXY &&
				expectation.originalExpectation &&
				expectation.originalExpectation.type === Expectation.Type.QUANTEL_CLIP_COPY
			) {
				// For Quantel, it is the original clip that should be scanned:
				const scan = generatePackageScan(expectation.originalExpectation, settings)
				expectations[scan.id] = scan
			} else {
				const scan = generatePackageScan(expectation, settings)
				expectations[scan.id] = scan
			}

			if (!settings.skipDeepScan) {
				// All files that have been copied should also be deep-scanned:
				const deepScan = generatePackageDeepScan(expectation, settings)
				expectations[deepScan.id] = deepScan
			}
		}

		if (expectation0.sideEffect?.thumbnailContainerId && expectation0.sideEffect?.thumbnailPackageSettings) {
			const packageContainer = packageContainers[expectation0.sideEffect.thumbnailContainerId]

			if (packageContainer) {
				const thumbnail = generateMediaFileThumbnail(
					expectation,
					expectation0.sideEffect.thumbnailContainerId,
					expectation0.sideEffect.thumbnailPackageSettings,
					packageContainer
				)
				expectations[thumbnail.id] = thumbnail
			}
		}

		if (expectation0.sideEffect?.previewContainerId && expectation0.sideEffect?.previewPackageSettings) {
			const packageContainer = packageContainers[expectation0.sideEffect.previewContainerId]

			if (packageContainer) {
				const preview = generateMediaFilePreview(
					expectation,
					expectation0.sideEffect.previewContainerId,
					expectation0.sideEffect.previewPackageSettings,
					packageContainer
				)
				expectations[preview.id] = preview
			}
		}

		if (expectation0.sideEffect?.loudnessPackageSettings) {
			const loudness = generatePackageLoudness(
				expectation,
				expectation0.sideEffect?.loudnessPackageSettings,
				settings
			)
			expectations[loudness.id] = loudness
		}

		if (expectation0.sideEffect?.iframes) {
			const iframes = generatePackageIframes(expectation, settings)
			expectations[iframes.id] = iframes
		}
	} else if (expectation0.type === Expectation.Type.QUANTEL_CLIP_COPY) {
		const expectation = expectation0 as Expectation.QuantelClipCopy

		if (!expectation0.external) {
			// All files that have been copied should also be scanned:
			const scan = generatePackageScan(expectation, settings)
			expectations[scan.id] = scan

			if (!settings.skipDeepScan) {
				// All files that have been copied should also be deep-scanned:
				const deepScan = generatePackageDeepScan(expectation, settings)
				expectations[deepScan.id] = deepScan
			}
		}

		if (expectation0.sideEffect?.thumbnailContainerId && expectation0.sideEffect?.thumbnailPackageSettings) {
			const packageContainer = packageContainers[expectation0.sideEffect.thumbnailContainerId]

			if (packageContainer) {
				const thumbnail = generateQuantelClipThumbnail(
					expectation,
					expectation0.sideEffect.thumbnailContainerId,
					expectation0.sideEffect.thumbnailPackageSettings,
					packageContainer
				)
				expectations[thumbnail.id] = thumbnail
			}
		}

		if (expectation0.sideEffect?.previewContainerId && expectation0.sideEffect?.previewPackageSettings) {
			const packageContainer = packageContainers[expectation0.sideEffect.previewContainerId]

			if (packageContainer) {
				const preview = generateQuantelClipPreview(
					expectation,
					expectation0.sideEffect.previewContainerId,
					expectation0.sideEffect.previewPackageSettings,
					packageContainer
				)
				expectations[preview.id] = preview
			}
		}

		if (expectation0.sideEffect?.loudnessPackageSettings) {
			const loudness = generatePackageLoudness(
				expectation,
				expectation0.sideEffect?.loudnessPackageSettings,
				settings
			)
			expectations[loudness.id] = loudness
		}
	}
	return expectations
}
/** Returns expectations to handle a copy to a temporary storage */
function getCopyToTemporaryStorage(
	_logger: LoggerInstance,
	useTemporaryStorage: PackageContainer,
	settings: PackageManagerSettings,
	expectation0: GenerateExpectation
): ExpectationCollection {
	const expectations: ExpectationCollection = {}

	if (
		expectation0.type === Expectation.Type.FILE_COPY ||
		expectation0.type === Expectation.Type.FILE_VERIFY ||
		expectation0.type === Expectation.Type.QUANTEL_CLIP_COPY
	) {
		const expectation = expectation0
		const proxy: GenerateExpectation | undefined = generatePackageCopyFileProxy(
			expectation,
			settings,
			TEMPORARY_STORAGE_ID,
			useTemporaryStorage
		)
		if (proxy) {
			proxy.external = expectation0.external
			proxy.sideEffect = expectation0.sideEffect
			expectations[proxy.id] = proxy
		}
	}

	return expectations
}

function addExpectation(
	logger: LoggerInstance,
	activeRundownMap: Map<RundownId, PackageManagerActiveRundown>,
	expectations: ExpectationCollection,
	packageWrap: ExpectedPackageWrap,
	exp: Expectation.Any
) {
	// Set the priority of the Expectation:
	exp.priority = getPriority(activeRundownMap, packageWrap, exp)

	const existingExp = expectations[exp.id]
	if (existingExp) {
		// There is already an expectation pointing at the same place.

		existingExp.priority = Math.min(existingExp.priority, exp.priority)

		const existingPackage = existingExp.fromPackages[0]
		const newPackage = exp.fromPackages[0]

		if (existingPackage.expectedContentVersionHash !== newPackage.expectedContentVersionHash) {
			// log warning:
			logger.warn(`WARNING: 2 expectedPackages have the same content, but have different contentVersions!`)
			logger.warn(`"${existingPackage.id}": ${existingPackage.expectedContentVersionHash}`)
			logger.warn(`"${newPackage.id}": ${newPackage.expectedContentVersionHash}`)
			logger.warn(`${JSON.stringify(exp.startRequirement)}`)

			// TODO: log better warnings!
		} else {
			existingExp.fromPackages.push(exp.fromPackages[0])
		}
	} else {
		expectations[exp.id] = {
			...exp,
			sideEffect: packageWrap.expectedPackage.sideEffect,
			external: packageWrap.external,
		}
	}
}
/** Returns a priority for an expectation. */
function getPriority(
	activeRundownMap: Map<RundownId, PackageManagerActiveRundown>,
	packageWrap: ExpectedPackageWrap,
	exp: Expectation.Any
): number {
	// Returns the initial priority, based on the expectedPackage

	const activeRundown: PackageManagerActiveRundown | undefined = packageWrap.expectedPackage.rundownId
		? activeRundownMap.get(packageWrap.expectedPackage.rundownId)
		: undefined

	if (activeRundown) {
		// The expected package is in an active rundown.
		// Earlier rundowns should have higher priority:
		return exp.priority + activeRundown._rank + PriorityMagnitude.PLAY_NOW
	} else {
		// The expected package is in an inactive rundown.
		// Make that a low priority:
		return exp.priority + PriorityMagnitude.OTHER
	}
}
type ExpectationCollection = Record<ExpectationId, GenerateExpectation>

function copyExpectationCollection(org: ExpectationCollection, add: ExpectationCollection): void {
	for (const [key, value] of objectEntries(add)) {
		org[key] = value
	}
}
