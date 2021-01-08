import { PackageOriginMetadata } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../expectationApi'
import * as path from 'path'
import * as fs from 'fs'
import { promisify } from 'util'
import { roboCopyFile } from '../lib/robocopy'
import { GenericWorker, IWorkInProgress, WorkInProgress } from '../worker'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)

export class NodeJSWorker extends GenericWorker {
	doYouSupportExpectation(exp: Expectation.Any): boolean {
		if (exp.type === Expectation.Type.MEDIA_FILE_COPY) {
			return true
		}
		return false
	}
	isExpectationReadyToStartWorkingOn(exp: Expectation.Any): Promise<{ ready: boolean; reason?: string }> {
		if (exp.type === Expectation.Type.MEDIA_FILE_COPY) {
			return MediaFileCopy.isExpectationReadyToStartWorkingOn(exp)
		}
		throw new Error(`Unsupported expectation.type "${exp.type}"`)
	}
	isExpectationFullfilled(exp: Expectation.Any): Promise<{ fulfilled: boolean; reason?: string }> {
		if (exp.type === Expectation.Type.MEDIA_FILE_COPY) {
			return MediaFileCopy.isExpectationFullfilled(exp)
		}
		throw new Error(`Unsupported expectation.type "${exp.type}"`)
	}
	workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress> {
		if (exp.type === Expectation.Type.MEDIA_FILE_COPY) {
			return MediaFileCopy.workOnExpectation(exp)
		}
		throw new Error(`Unsupported expectation.type "${exp.type}"`)
	}
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace MediaFileCopy {
	export async function isExpectationReadyToStartWorkingOn(
		exp: Expectation.ExpectationMediaFile
	): Promise<{ ready: boolean; reason?: string }> {
		const lookupOrigin = await lookupExpOrigin(exp)

		return {
			ready: !lookupOrigin.errorReason,
			reason: lookupOrigin.errorReason,
		}
	}
	export async function isExpectationFullfilled(
		exp: Expectation.ExpectationMediaFile
	): Promise<{ fulfilled: boolean; reason?: string }> {
		/** undefined if all good, error string otherwise */
		let reason: undefined | string = 'Unknown fulfill error'

		const fullPath = path.join(exp.endRequirement.location.folderPath, exp.endRequirement.filePath)

		try {
			await fsAccess(fullPath, fs.constants.R_OK)
			// The file exists

			// check that the file is of the right version:
			const stat = await fsStat(fullPath)
			reason = undefined

			if (exp.endRequirement.version.fileSize && stat.size !== exp.endRequirement.version.fileSize) {
				reason = `File size differ (${exp.endRequirement.version.fileSize}, ${stat.size})`
			}
			if (
				exp.endRequirement.version.modifiedDate &&
				stat.mtimeMs * 1000 !== exp.endRequirement.version.modifiedDate
			) {
				reason = `Modified date differ (${exp.endRequirement.version.modifiedDate}, ${stat.mtimeMs * 1000})`
			}
			if (exp.endRequirement.version.checksum) {
				// TODO
				throw new Error('Checksum not implemented yet')
			}

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
		} catch (err) {
			// File is not readable
			reason = `File does not exist: ${err.toString()}`
		}

		return { fulfilled: !reason, reason }
	}
	export async function workOnExpectation(exp: Expectation.ExpectationMediaFile): Promise<IWorkInProgress> {
		const lookupOrigin = await lookupExpOrigin(exp)

		if (lookupOrigin.errorReason) {
			throw new Error(`Can't start working due to: ${lookupOrigin.errorReason}`)
		}
		if (!lookupOrigin.foundOriginPath) {
			throw new Error(`No origin path found!`)
		}

		const targetPath = path.join(exp.endRequirement.location.folderPath, exp.endRequirement.filePath)

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
				workInProgress._reportComplete()
			})
			.catch((err) => {
				workInProgress._reportError(err)
			})

		return workInProgress
	}

	// eslint-disable-next-line no-inner-declarations
	async function lookupExpOrigin(exp: Expectation.ExpectationMediaFile) {
		/** undefined if all good, error string otherwise */
		let errorReason: undefined | string = 'No origin found'
		let foundOriginPath: undefined | string = undefined

		// See if the file is available at any of the origins:

		for (const origin of exp.startRequirement.origins) {
			if (origin.type === PackageOriginMetadata.OriginType.LOCAL_FOLDER) {
				const fullPath = path.join(origin.folderPath, origin.fileName || exp.endRequirement.filePath)

				try {
					await fsAccess(fullPath, fs.constants.R_OK)
					// The file exists
					errorReason = undefined
				} catch (err) {
					// File is not readable
					errorReason = `Not able to read file: ${err.toString()}`
				}
				if (!errorReason) {
					// check that the file is of the right version

					const stat = await fsStat(fullPath)

					errorReason = undefined

					if (exp.endRequirement.version.fileSize && stat.size !== exp.endRequirement.version.fileSize) {
						errorReason = `Origin file size differ (${exp.endRequirement.version.fileSize}, ${stat.size})`
					}
					if (
						exp.endRequirement.version.modifiedDate &&
						stat.mtimeMs * 1000 !== exp.endRequirement.version.modifiedDate
					) {
						errorReason = `Origin modified date differ (${exp.endRequirement.version.modifiedDate}, ${
							stat.mtimeMs * 1000
						})`
					}
					if (exp.endRequirement.version.checksum) {
						// TODO
						throw new Error('Checksum not implemented yet')
					}
				}
				if (!errorReason) {
					// All good, no need to look further
					foundOriginPath = fullPath
					break
				}
			} else {
				throw new Error(`Unsupported MediaFile origin.type "${origin.type}"`)
			}
		}

		// also check that the target location is writeable

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
}
