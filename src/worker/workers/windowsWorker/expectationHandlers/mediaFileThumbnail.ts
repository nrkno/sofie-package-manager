import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { exec, ChildProcess } from 'child_process'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { hashObj } from '../../../lib/lib'
import { Expectation } from '../../../expectationApi'
import { compareFileVersion, convertStatToVersion, unlinkIfExists } from '../lib/lib'
import { IWorkInProgress, WorkInProgress } from '../../../worker'
import * as _ from 'underscore'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)

export const MediaFileThumbnail: ExpectationWindowsHandler = {
	isExpectationReadyToStartWorkingOn: async (exp: Expectation.Any): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready) return lookupSource
		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) return lookupTarget

		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (exp: Expectation.Any): Promise<{ fulfilled: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		try {
			await fsAccess(lookupTarget.foundPath, fs.constants.R_OK)
			// The file exists
		} catch (err) {
			return { fulfilled: false, reason: `File does not exist: ${err.toString()}` }
		}
		const stat = await fsStat(lookupSource.foundPath)
		const statVersion = convertStatToVersion(stat)
		const fileVersionHash = hashObj(statVersion)

		const sideCar = await getSideCar(exp, lookupTarget.foundAccessor)

		if (!sideCar) {
			return { fulfilled: false, reason: 'No file found' }
		} else if (sideCar.fileVersionHash !== fileVersionHash) {
			return { fulfilled: false, reason: `Thumbnail version doesn't match file` }
		} else if (sideCar.filePath !== lookupSource.foundPath) {
			return { fulfilled: false, reason: `Thumbnail path doesn't match` }
		} else if (!_.isEqual(sideCar.version, exp.endRequirement.version)) {
			return { fulfilled: false, reason: `Thumbnail path doesn't match expectation` }
		} else {
			return { fulfilled: true, reason: 'Thumbnail already matches file' }
		}
	},
	workOnExpectation: async (exp: Expectation.Any): Promise<IWorkInProgress> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the media file

		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)
		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		let ffMpegProcess: ChildProcess | undefined
		const workInProgress = new WorkInProgress(async () => {
			// On cancel
			if (ffMpegProcess) {
				ffMpegProcess.kill() // todo: signal?
			}
		})

		setImmediate(() => {
			;(async () => {
				const startTime = Date.now()

				try {
					await fsAccess(lookupSource.foundPath, fs.constants.R_OK)
					// The file exists
				} catch (err) {
					workInProgress._reportError(new Error(`File does not exist: ${err.toString()}`))
					return
				}
				const stat = await fsStat(lookupSource.foundPath)
				const sourceVersion = convertStatToVersion(stat)
				const sourceVersionHash = hashObj(sourceVersion)

				const sideCar: SideCar = {
					filePath: lookupSource.foundPath, // maybe change to local path?
					fileVersionHash: sourceVersionHash,
					version: exp.endRequirement.version,
				}
				removeSideCar(exp, lookupTarget.foundAccessor)

				if (lookupTarget.foundAccessor.type !== Accessor.AccessType.LOCAL_FOLDER)
					throw new Error(`Unsupported target Accessor type "${lookupTarget.foundAccessor.type}"`)

				// Remove the target file if it already exists:
				await unlinkIfExists(lookupTarget.foundPath)

				// Use FFProbe to generate the thumbnail:
				const args = [
					process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
					'-hide_banner',
					`-i "${lookupSource.foundPath}"`,
					'-frames:v 1',
					`-vf thumbnail,scale=${exp.endRequirement.version.width || 256}:` +
						`${exp.endRequirement.version.height || -1}`,
					'-threads 1',
					`"${lookupTarget.foundPath}"`,
				]
				workInProgress._reportProgress(sourceVersionHash, 0.1)

				ffMpegProcess = exec(args.join(' '), (err, _stdout, _stderr) => {
					// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
					ffMpegProcess = undefined
					if (err) {
						workInProgress._reportError(err)
						return
					}

					saveSideCar(exp, lookupTarget.foundAccessor, sideCar)
						.then(() => {
							const duration = Date.now() - startTime
							workInProgress._reportComplete(
								sourceVersionHash,
								`Thumbnail generation completed in ${Math.round(duration / 100) / 10}s`,
								undefined
							)
						})
						.catch((err) => {
							workInProgress._reportError(err)
						})
				})
			})().catch((err) => {
				workInProgress._reportError(err)
			})
		})

		return workInProgress
	},
	removeExpectation: async (exp: Expectation.Any): Promise<{ removed: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		await removeSideCar(exp, lookupTarget.foundAccessor)

		if (lookupTarget.foundAccessor.type === Accessor.AccessType.LOCAL_FOLDER) {
			await unlinkIfExists(lookupTarget.foundPath)
		} else throw new Error(`Unsupported target Accessor type "${lookupTarget.foundAccessor.type}"`)

		return { removed: true, reason: 'Removed thumbnail' }
	},
}
function isMediaFileThumbnail(exp: Expectation.Any): exp is Expectation.MediaFileThumbnail {
	return exp.type === Expectation.Type.MEDIA_FILE_THUMBNAIL
}

type LookupPackageContainer =
	| { foundPath: string; foundAccessor: AccessorOnPackage.Any; ready: true; reason: string }
	| {
			foundPath: undefined
			foundAccessor: undefined
			ready: false
			reason: string
	  }

/** Check that we have any access to a Package on an source-packageContainer, then return the packageContainer */
async function lookupSources(exp: Expectation.MediaFileThumbnail): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No source found'

	// See if the file is available at any of the sources:
	for (const packageContainer of exp.startRequirement.sources) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
				errorReason = undefined

				const folderPath = accessor.folderPath
				if (!folderPath) {
					errorReason = `Accessor "${accessorId}": folder path not set`
					continue // Maybe next source works?
				}
				const filePath = accessor.filePath || exp.startRequirement.content.filePath
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
				const sourceVersion = convertStatToVersion(stat)
				errorReason = compareFileVersion(sourceVersion, exp.startRequirement.version)

				if (!errorReason) {
					// All good, no need to look further:
					return {
						foundPath: fullPath,
						foundAccessor: accessor,
						ready: true,
						reason: `Can access source "${packageContainer.label}" through accessor "${accessorId}"`,
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

/** Check that we have any access to a Package on an target-packageContainer, then return the packageContainer */
async function lookupTargets(exp: Expectation.MediaFileThumbnail): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const packageContainer of exp.endRequirement.targets) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
				errorReason = undefined
				if (!accessor.folderPath) {
					errorReason = `Accessor folderPath not set`
					continue
				}

				if (!errorReason) {
					// All good, no need to look further:
					return {
						foundPath: path.join(
							accessor.folderPath,
							accessor.filePath || exp.endRequirement.content.filePath
						),
						foundAccessor: accessor,
						ready: true,
						reason: `Can access target "${packageContainer.label}" through accessor "${accessorId}"`,
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

async function getSideCar(
	exp: Expectation.MediaFileThumbnail,
	accessor: AccessorOnPackage.Any
): Promise<SideCar | undefined> {
	if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		const sideCarPath = getSideCarPath(exp, accessor)

		try {
			await fsAccess(sideCarPath, fs.constants.R_OK)
			// The file exists

			const text = await fsReadFile(sideCarPath, {
				encoding: 'utf-8',
			})
			return JSON.parse(text)
		} catch (err) {
			return undefined
		}
	} else throw new Error(`Unsupported Accessor type "${accessor.type}"`)
}
async function saveSideCar(
	exp: Expectation.MediaFileThumbnail,
	accessor: AccessorOnPackage.Any,
	sidecar: SideCar
): Promise<void> {
	if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		const sideCarPath = getSideCarPath(exp, accessor)

		await fsWriteFile(sideCarPath, JSON.stringify(sidecar))
	} else throw new Error(`Unsupported Accessor type "${accessor.type}"`)
}
async function removeSideCar(exp: Expectation.MediaFileThumbnail, accessor: AccessorOnPackage.Any): Promise<void> {
	if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		const sideCarPath = getSideCarPath(exp, accessor)

		await unlinkIfExists(sideCarPath)
	} else throw new Error(`Unsupported Accessor type "${accessor.type}"`)
}
function getSideCarPath(exp: Expectation.MediaFileThumbnail, accessor: AccessorOnPackage.Any) {
	if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		if (!accessor.folderPath) throw new Error(`Accessor folderPath not set`)
		return (
			path.join(accessor.folderPath, accessor.filePath || exp.endRequirement.content.filePath) + '_sidecar.json'
		)
	} else throw new Error(`Unsupported Accessor type "${accessor.type}"`)
}
interface SideCar {
	filePath: string
	fileVersionHash: string
	version: {
		width?: number
		height?: number
	}
}
