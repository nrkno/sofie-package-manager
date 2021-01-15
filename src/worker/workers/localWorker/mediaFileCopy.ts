import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../../worker/expectationApi'
import { IWorkInProgress, WorkInProgress } from '../../../worker/worker'
import { roboCopyFile } from '../../lib/robocopy'
import { compareFileVersion } from './lib'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)

export async function isExpectationReadyToStartWorkingOn(
	exp: Expectation.MediaFileCopy
): Promise<{ ready: boolean; reason: string }> {
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
}
export async function isExpectationFullfilled(
	exp: Expectation.MediaFileCopy
): Promise<{ fulfilled: boolean; reason: string }> {
	/** undefined if all good, error string otherwise */
	let reason: undefined | string = 'Unknown fulfilled error'

	const lookupTarget = await lookupTargets(exp)
	if (!lookupTarget.ready) return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

	const fullPath = lookupTarget.foundPath
	// path.join( exp.endRequirement.location.folderPath, exp.endRequirement.content.filePath)

	try {
		await fsAccess(fullPath, fs.constants.R_OK)
		// The file exists
	} catch (err) {
		// File is not readable
		return { fulfilled: false, reason: `File does not exist: ${err.toString()}` }
	}

	// check that the file is of the right version:
	const stat = await fsStat(fullPath)
	reason = compareFileVersion(stat, exp.endRequirement.version)

	if (reason) return { fulfilled: false, reason }

	const lookupSource = await lookupSources(exp)
	// TODO: how to handle if the source is gone? is it still fullfilled then?
	if (lookupSource && lookupSource.ready && lookupSource.foundPath) {
		const sourceStat = await fsStat(lookupSource.foundPath)

		if (stat.size !== sourceStat.size) {
			reason = `File size differ from source (${sourceStat.size}, ${stat.size})`
		}
		if (stat.mtimeMs !== sourceStat.mtimeMs) {
			reason = `Modified time differ from source (${sourceStat.mtimeMs}, ${stat.mtimeMs})`
		}
		// TODO: check other things?
	}

	return {
		fulfilled: !reason,
		reason: reason || `File "${exp.endRequirement.content.filePath}" already exists on location`,
	}
}
export async function workOnExpectation(exp: Expectation.MediaFileCopy): Promise<IWorkInProgress> {
	// Copies the file from Source to Target

	const startTime = Date.now()

	const lookupSource = await lookupSources(exp)
	if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)
	if (!lookupSource.foundPath) throw new Error(`No source path found!`)

	const lookupTarget = await lookupTargets(exp)
	if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)
	if (!lookupTarget.foundPath) throw new Error(`No target path found!`)

	const sourcePath = lookupSource.foundPath //  path.join(exp.endRequirement.location.folderPath, exp.endRequirement.content.filePath)
	const targetPath = lookupTarget.foundPath //  path.join(exp.endRequirement.location.folderPath, exp.endRequirement.content.filePath)

	if (lookupSource.foundAccessor.type !== Accessor.AccessType.LOCAL_FOLDER) {
		throw new Error(`MediaFile.workOnExpectation: Unsupported accessor type "${lookupSource.foundAccessor.type}"`)
	}
	const workInProgress = new WorkInProgress(async () => {
		// on cancel
		copying.cancel()
		// todo: should we remove the target file?
		await fsUnlink(targetPath)
	})
	const copying = roboCopyFile(sourcePath, targetPath, (progress: number) => {
		workInProgress._reportProgress(progress)
	})

	copying
		.then(() => {
			const duration = Date.now() - startTime
			workInProgress._reportComplete(`Copy completed in ${Math.round(duration / 100) / 10}s`, undefined)
		})
		.catch((err) => {
			workInProgress._reportError(err)
		})

	return workInProgress
}
export async function removeExpectation(exp: Expectation.MediaFileCopy): Promise<{ removed: boolean; reason: string }> {
	// Remove the file on the location

	const lookupTarget = await lookupTargets(exp)
	if (!lookupTarget.ready) {
		return { removed: false, reason: `No access to target: ${lookupTarget.reason}` }
	}

	const targetPath = lookupTarget.foundPath // path.join(exp.endRequirement.location.folderPath, exp.endRequirement.content.filePath)

	// try {
	// 	await fsAccess(targetPath, fs.constants.R_OK)
	// 	// The file exists
	// } catch (err) {
	// 	// File is not writeable
	// 	return { removed: false, reason: `Cannot write to file: ${err.toString()}` }
	// }

	try {
		await fsUnlink(targetPath)
	} catch (err) {
		return { removed: false, reason: `Cannot remove file: ${err.toString()}` }
	}

	return { removed: true, reason: `Removed file "${exp.endRequirement.content.filePath}" from location` }
}

type LookupResource =
	| { foundPath: string; foundAccessor: AccessorOnPackage.Any; ready: true; reason: string }
	| {
			foundPath: undefined
			foundAccessor: undefined
			ready: false
			reason: string
	  }

/** Check that we have any access to a Package on an source-resource, then return the resource */
async function lookupSources(exp: Expectation.MediaFileCopy): Promise<LookupResource> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No source found'

	// See if the file is available at any of the sources:
	for (const resource of exp.startRequirement.sources) {
		for (const [accessorId, accessor] of Object.entries(resource.accessors)) {
			if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
				errorReason = undefined

				const folderPath = accessor.folderPath
				if (!folderPath) {
					errorReason = `Accessor "${accessorId}": folder path not set`
					continue // Maybe next source works?
				}
				const filePath = accessor.filePath // || exp.endRequirement.content.filePath
				if (!filePath) {
					errorReason = `Accessor "${accessorId}": file path not set`
					continue // Maybe next source works?
				}

				const fullPath = path.join(folderPath, filePath)

				try {
					await fsAccess(fullPath, fs.constants.R_OK)
					// The file exists
				} catch (err) {
					// File is not readable
					errorReason = `Not able to read file: ${err.toString()}`
				}
				if (errorReason) continue // Maybe next accessor works?

				// Check that the file is of the right version:
				const stat = await fsStat(fullPath)
				errorReason = compareFileVersion(stat, exp.endRequirement.version)

				if (!errorReason) {
					// All good, no need to look further:
					return {
						foundPath: fullPath,
						foundAccessor: accessor,
						ready: true,
						reason: `Can access source "${resource.label}" through accessor "${accessorId}"`,
					}
				}
			} else {
				errorReason = `Unsupported accessor "${accessorId}" type "${accessor.type}"`
			}
		}
	}
	return {
		foundPath: undefined,
		foundAccessor: undefined,
		ready: false,
		reason: errorReason,
	}
}

/** Check that we have any access to a Package on an target-resource, then return the resource */
async function lookupTargets(exp: Expectation.MediaFileCopy): Promise<LookupResource> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const resource of exp.endRequirement.targets) {
		for (const [accessorId, accessor] of Object.entries(resource.accessors)) {
			if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
				errorReason = undefined

				const folderPath = accessor.folderPath
				if (!folderPath) {
					errorReason = `Accessor "${accessorId}": folder path not set`
					continue // Maybe next target works?
				}
				const filePath = accessor.filePath || exp.endRequirement.content.filePath
				if (!filePath) {
					errorReason = `Accessor "${accessorId}": file path not set`
					continue // Maybe next target works?
				}

				const fullPath = path.join(folderPath, filePath)

				try {
					await fsAccess(folderPath, fs.constants.W_OK)
					// The file exists
				} catch (err) {
					// File is not readable
					errorReason = `Not able to write to file: ${err.toString()}`
				}
				// if (errorReason) continue // Maybe next accessor works?
				// Check that the file is of the right version:
				// const stat = await fsStat(fullPath)
				// errorReason = compareFileVersion(stat, exp.endRequirement.version)

				if (!errorReason) {
					// All good, no need to look further:
					return {
						foundPath: fullPath,
						foundAccessor: accessor,
						ready: true,
						reason: `Can access target "${resource.label}" through accessor "${accessorId}"`,
					}
				}
			} else {
				errorReason = `Unsupported accessor "${accessorId}" type "${accessor.type}"`
			}
		}
	}
	return {
		foundPath: undefined,
		foundAccessor: undefined,
		ready: false,
		reason: errorReason,
	}
}
