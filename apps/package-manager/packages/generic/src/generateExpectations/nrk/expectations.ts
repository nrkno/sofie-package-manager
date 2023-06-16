import { ActivePlaylist, ActiveRundown, ExpectedPackageWrap, PackageContainers } from '../../packageManager'
import { PackageManagerSettings } from '../../generated/options'
import { ExpectedPackage, PackageContainer, Expectation, hashObj, LoggerInstance } from '@sofie-package-manager/api'
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
} from './expectations-lib'
import { getSmartbullExpectedPackages, shouldBeIgnored } from './smartbull'
import { TEMPORARY_STORAGE_ID } from './lib'

/** Generate and return the appropriate Expectations based on the provided expectedPackages */
export function getExpectations(
	logger: LoggerInstance,
	managerId: string,
	packageContainers: PackageContainers,
	_activePlaylist: ActivePlaylist,
	activeRundowns: ActiveRundown[],
	expectedPackages: ExpectedPackageWrap[],
	settings: PackageManagerSettings
): { [id: string]: Expectation.Any } {
	const expectations: ExpectationCollection = {}

	// Note: All of this is a preliminary implementation!
	// A blueprint-like plug-in architecture might be a future idea

	/** If set, we should first copy media to a temporary storage and use that for side-effects  */
	const useTemporaryStorage = packageContainers[TEMPORARY_STORAGE_ID] as PackageContainer | undefined

	// Sort, so that we handle the high-prio first:
	expectedPackages.sort((a, b) => {
		// Lowest first: (lower is better)
		if (a.priority > b.priority) return 1
		if (a.priority < b.priority) return -1
		return 0
	})
	// Prepare:
	const activeRundownMap = new Map<string, ActiveRundown>()
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

	const returnExpectations: { [id: string]: Expectation.Any } = {}
	for (const [id, exp] of Object.entries(expectations)) {
		returnExpectations[id] = exp as any
	}
	return returnExpectations
}
/** Generate and return the most basic expectations based on the provided expectedPackages */
function getBasicExpectations(
	_logger: LoggerInstance,
	managerId: string,
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
		const hasAnySourceAccessors = !!packageWrap.sources.find((source) => Object.keys(source.accessors).length > 0)
		const hasAnyTargetAccessors = !!packageWrap.targets.find((target) => Object.keys(target.accessors).length > 0)

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
			copyProps(expectations, getSideEffectOfExpectation(_logger, packageContainers, settings, expectation))
		}
	} else {
		const temoraryStorageExpectations: ExpectationCollection = {}
		for (const expectation0 of groupExpectations(expectations)) {
			// We need to copy the expectation to a temporary storage,
			// get those expectations and put them in temoraryStorageExpectations:
			copyProps(
				temoraryStorageExpectations,
				getCopyToTemporaryStorage(_logger, useTemporaryStorage, settings, expectation0)
			)
		}

		// Okay, now let's generate the side-effects from the temoraryStorageExpectations instead:
		for (const [id, expectation] of Object.entries(temoraryStorageExpectations)) {
			// get side-effects:
			const resultingExpectations: ExpectationCollection = getSideEffectOfExpectation(
				_logger,
				packageContainers,
				settings,
				expectation
			)
			if (Object.keys(resultingExpectations).length > 0) {
				// Add the CopyToTemporaryStorage expectation:
				expectations[id] = expectation

				copyProps(expectations, resultingExpectations)
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
	for (const expectation of Object.values(expectations)) {
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
		const expectation = expectation0 as Expectation.FileCopy | Expectation.FileVerify | Expectation.FileCopyProxy

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

			// All files that have been copied should also be deep-scanned:
			const deepScan = generatePackageDeepScan(expectation, settings)
			expectations[deepScan.id] = deepScan
		}

		if (expectation0.sideEffect?.thumbnailContainerId && expectation0.sideEffect?.thumbnailPackageSettings) {
			const packageContainer = packageContainers[expectation0.sideEffect.thumbnailContainerId] as
				| PackageContainer
				| undefined

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
			const packageContainer = packageContainers[expectation0.sideEffect.previewContainerId] as
				| PackageContainer
				| undefined

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
	} else if (expectation0.type === Expectation.Type.QUANTEL_CLIP_COPY) {
		const expectation = expectation0 as Expectation.QuantelClipCopy

		if (!expectation0.external) {
			// All files that have been copied should also be scanned:
			const scan = generatePackageScan(expectation, settings)
			expectations[scan.id] = scan

			// All files that have been copied should also be deep-scanned:
			const deepScan = generatePackageDeepScan(expectation, settings)
			expectations[deepScan.id] = deepScan
		}

		if (expectation0.sideEffect?.thumbnailContainerId && expectation0.sideEffect?.thumbnailPackageSettings) {
			const packageContainer = packageContainers[expectation0.sideEffect.thumbnailContainerId] as
				| PackageContainer
				| undefined

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
			const packageContainer = packageContainers[expectation0.sideEffect.previewContainerId] as
				| PackageContainer
				| undefined

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
		const expectation = expectation0 as Expectation.FileCopy | Expectation.FileVerify | Expectation.QuantelClipCopy
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
	activeRundownMap: Map<string, ActiveRundown>,
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
	activeRundownMap: Map<string, ActiveRundown>,
	packageWrap: ExpectedPackageWrap,
	exp: Expectation.Any
): number {
	// Returns the initial priority, based on the expectedPackage

	const activeRundown: ActiveRundown | undefined = packageWrap.expectedPackage.rundownId
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
interface ExpectationCollection {
	[id: string]: GenerateExpectation
}
function copyProps<T>(org: { [key: string]: T }, add: { [key: string]: T }): void {
	Object.entries(add).forEach(([key, value]) => (org[key] = value))
}
