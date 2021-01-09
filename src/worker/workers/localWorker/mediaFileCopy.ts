import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { PackageOrigin } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../../worker/expectationApi'
import { IWorkInProgress, WorkInProgress } from '../../../worker/worker'
import { roboCopyFile } from '../../lib/robocopy'
import { compareFileVersion } from './lib'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)

export async function isExpectationReadyToStartWorkingOn(
	exp: Expectation.MediaFileCopy
): Promise<{ ready: boolean; reason?: string }> {
	if (exp.endRequirement.location.type !== PackageOrigin.OriginType.LOCAL_FOLDER) {
		return {
			ready: false,
			reason: `Unsupported location.type "${exp.endRequirement.location.type}"`,
		}
	}

	const lookupOrigin = await lookupExpOrigin(exp)

	return {
		ready: !lookupOrigin.errorReason,
		reason: lookupOrigin.errorReason,
	}
}
export async function isExpectationFullfilled(
	exp: Expectation.MediaFileCopy
): Promise<{ fulfilled: boolean; reason?: string }> {
	/** undefined if all good, error string otherwise */
	let reason: undefined | string = 'Unknown fulfilled error'

	const fullPath = path.join(exp.endRequirement.location.folderPath, exp.endRequirement.content.filePath)

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

	const lookupOrigin = await lookupExpOrigin(exp)
	// TODO: how to handle if the origin is gone? is it still fullfilled then?
	if (lookupOrigin && !lookupOrigin.errorReason && lookupOrigin.foundOriginPath) {
		const originStat = await fsStat(lookupOrigin.foundOriginPath)

		if (stat.size !== originStat.size) {
			reason = `File size differ from origin (${originStat.size}, ${stat.size})`
		}
		if (stat.mtimeMs !== originStat.mtimeMs) {
			reason = `Modified time differ from origin (${originStat.mtimeMs}, ${stat.mtimeMs})`
		}
		// TODO: check other things?
	}

	return { fulfilled: !reason, reason }
}
export async function workOnExpectation(exp: Expectation.MediaFileCopy): Promise<IWorkInProgress> {
	// Copies the file from Origin to Location

	const lookupOrigin = await lookupExpOrigin(exp)

	if (lookupOrigin.errorReason) {
		throw new Error(`Can't start working due to: ${lookupOrigin.errorReason}`)
	}
	if (!lookupOrigin.foundOriginPath) {
		throw new Error(`No origin path found!`)
	}

	const targetPath = path.join(exp.endRequirement.location.folderPath, exp.endRequirement.content.filePath)

	const workInProgress = new WorkInProgress(async () => {
		// on cancel
		copying.cancel()
		// todo: should we remove the target file?
	})
	const copying = roboCopyFile(lookupOrigin.foundOriginPath, targetPath, (progress: number) => {
		workInProgress._reportProgress(progress)
	})

	copying
		.then(() => {
			workInProgress._reportComplete(undefined)
		})
		.catch((err) => {
			workInProgress._reportError(err)
		})

	return workInProgress
}
export async function removeExpectation(
	exp: Expectation.MediaFileCopy
): Promise<{ removed: boolean; reason?: string }> {
	// Remove the file on the location

	const targetPath = path.join(exp.endRequirement.location.folderPath, exp.endRequirement.content.filePath)

	try {
		await fsAccess(targetPath, fs.constants.R_OK)
		// The file exists
	} catch (err) {
		// File is not writeable
		return { removed: false, reason: `Cannot write to file: ${err.toString()}` }
	}

	try {
		await fsUnlink(targetPath)
	} catch (err) {
		return { removed: false, reason: `Cannot remove file: ${err.toString()}` }
	}

	return { removed: true, reason: '' }
}

// eslint-disable-next-line no-inner-declarations
async function lookupExpOrigin(exp: Expectation.MediaFileCopy) {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No origin found'
	let foundOriginPath: undefined | string = undefined

	// See if the file is available at any of the origins:
	for (const origin of exp.startRequirement.origins) {
		if (origin.type === PackageOrigin.OriginType.LOCAL_FOLDER) {
			errorReason = undefined

			const folderPath = origin.folderPath
			if (!folderPath) {
				errorReason = `Origin folder path not set`
				continue // Maybe next origin works?
			}
			const filePath = origin.filePath || exp.endRequirement.content.filePath
			if (!filePath) {
				errorReason = `Origin file path not set`
				continue // Maybe next origin works?
			}

			const fullPath = path.join(folderPath, filePath)

			try {
				await fsAccess(fullPath, fs.constants.R_OK)
				// The file exists
			} catch (err) {
				// File is not readable
				errorReason = `Not able to read file: ${err.toString()}`
			}
			if (errorReason) continue // Maybe next origin works?

			// Check that the file is of the right version:
			const stat = await fsStat(fullPath)
			errorReason = compareFileVersion(stat, exp.endRequirement.version)

			if (!errorReason) {
				// All good, no need to look further
				foundOriginPath = fullPath
				break
			}
		} else {
			throw new Error(`Unsupported MediaFile origin.type "${origin.type}"`)
		}
	}

	// Also check that the target location is writeable:
	const targetPath = exp.endRequirement.location.folderPath
	try {
		await fsAccess(targetPath, fs.constants.W_OK)
		// Is writeable
	} catch (err) {
		errorReason = `Not able to write to location. ${err.toString()}`
	}

	if (errorReason) foundOriginPath = undefined
	return { foundOriginPath, errorReason }
}
