import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../../expectationApi'
import { IWorkInProgress, WorkInProgress } from '../../../worker'
import { roboCopyFile } from '../lib/robocopy'
import { compareActualExpectVersions, compareActualVersions } from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { hashObj } from '../../../lib/lib'
import { getAccessorHandle, isLocalFolderHandle } from '../../../accessorHandlers/accessor'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'

export const MediaFileCopy: ExpectationWindowsHandler = {
	isExpectationReadyToStartWorkingOn: async (exp: Expectation.Any): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready) {
			return {
				ready: lookupSource.ready,
				reason: lookupSource.reason,
			}
		}
		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) {
			return {
				ready: lookupTarget.ready,
				reason: lookupTarget.reason,
			}
		}

		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (exp: Expectation.Any): Promise<{ fulfilled: boolean; reason: string }> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issuePackage) {
			return { fulfilled: false, reason: `File does not exist: ${issuePackage.toString()}` }
		}

		// check that the file is of the right version:
		const actualTargetVersion = await lookupTarget.handle.getPackageActualVersion()

		const actualVersionReason = compareActualExpectVersions(actualTargetVersion, exp.endRequirement.version)
		if (actualVersionReason) return { fulfilled: false, reason: actualVersionReason }

		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		const issueVersions = compareActualVersions(actualSourceVersion, actualTargetVersion)
		if (issueVersions) {
			return { fulfilled: false, reason: issueVersions }
		}

		return {
			fulfilled: true,
			reason: `File "${exp.endRequirement.content.filePath}" already exists on location`,
		}
	},
	workOnExpectation: async (exp: Expectation.Any): Promise<IWorkInProgress> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		const actualSourceVersion = lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)

		if (
			lookupSource.accessor.type !== Accessor.AccessType.LOCAL_FOLDER &&
			lookupTarget.accessor.type !== Accessor.AccessType.LOCAL_FOLDER
		) {
			if (!isLocalFolderHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
			if (!isLocalFolderHandle(lookupTarget.handle)) throw new Error(`Source AccessHandler type is wrong`)

			const workInProgress = new WorkInProgress(async () => {
				// on cancel
				copying.cancel()
				// todo: should we remove the target file?
				try {
					lookupTarget.handle.removePackage()
				} catch (err) {
					// todo: what to do if it fails at this point?
				}
			})

			const copying = roboCopyFile(
				lookupSource.handle.fullPath,
				lookupSource.handle.fullPath,
				(progress: number) => {
					workInProgress._reportProgress(actualSourceVersionHash, progress)
				}
			)

			copying
				.then(() => {
					const duration = Date.now() - startTime
					workInProgress._reportComplete(
						actualSourceVersionHash,
						`Copy completed in ${Math.round(duration / 100) / 10}s`,
						undefined
					)
				})
				.catch((err: Error) => {
					workInProgress._reportError(err)
				})
			return workInProgress
		} else {
			throw new Error(
				`MediaFileCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any): Promise<{ removed: boolean; reason: string }> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) {
			return { removed: false, reason: `No access to target: ${lookupTarget.reason}` }
		}

		try {
			await lookupTarget.handle.removePackage()
		} catch (err) {
			return { removed: false, reason: `Cannot remove file: ${err.toString()}` }
		}

		return { removed: true, reason: `Removed file "${exp.endRequirement.content.filePath}" from location` }
	},
}
function isMediaFileCopy(exp: Expectation.Any): exp is Expectation.MediaFileCopy {
	return exp.type === Expectation.Type.MEDIA_FILE_COPY
}

type LookupPackageContainer =
	| {
			accessor: AccessorOnPackage.Any
			handle: GenericAccessorHandle
			ready: true
			reason: string
	  }
	| {
			accessor: undefined
			handle: undefined
			ready: false
			reason: string
	  }

/** Check that we have any access to a Package on an source-packageContainer, then return the packageContainer */
async function lookupSources(exp: Expectation.MediaFileCopy): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No source found'

	// See if the file is available at any of the sources:
	for (const packageContainer of exp.startRequirement.sources) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle(accessor, exp.endRequirement.content)

			const issueHandle = handle.checkHandleRead()
			if (issueHandle) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueHandle}`
				continue // Maybe next source works?
			}

			const issuePackageContainer = await handle.checkPackageReadAccess()
			if (issuePackageContainer) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issuePackageContainer}`
				continue // Maybe next source works?
			}

			const actualSourceVersion = await handle.getPackageActualVersion()

			const issuePackageVersion = compareActualExpectVersions(actualSourceVersion, exp.endRequirement.version)
			if (issuePackageVersion) {
				errorReason = `${packageContainer.label}: ${issuePackageVersion}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
					// foundPath: fullPath,
					accessor: accessor,
					handle: handle,
					ready: true,
					reason: `Can access source "${packageContainer.label}" through accessor "${accessorId}"`,
				}
			}
		}
	}
	return {
		// foundPath: undefined,
		accessor: undefined,
		handle: undefined,
		ready: false,
		reason: errorReason,
	}
}

/** Check that we have any access to a Package on an target-packageContainer, then return the packageContainer */
async function lookupTargets(exp: Expectation.MediaFileCopy): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const packageContainer of exp.endRequirement.targets) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle(accessor, exp.endRequirement.content)

			const issueHandle = handle.checkHandleWrite()
			if (issueHandle) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueHandle}`
				continue // Maybe next source works?
			}

			const issuePackage = await handle.checkPackageContainerWriteAccess()
			if (issuePackage) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issuePackage}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
					// foundPath: fullPath,
					accessor: accessor,
					handle: handle,
					ready: true,
					reason: `Can access target "${packageContainer.label}" through accessor "${accessorId}"`,
				}
			}
		}
	}
	return {
		// foundPath: undefined,
		accessor: undefined,
		handle: undefined,
		ready: false,
		reason: errorReason,
	}
}
