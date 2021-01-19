import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { exec, ChildProcess } from 'child_process'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../../expectationApi'
import { compareFileVersion, convertStatToVersion } from '../lib/lib'
import { GenericWorker, IWorkInProgress, WorkInProgress } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { hashObj } from '../../../lib/lib'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)

export const MediaFileScan: ExpectationWindowsHandler = {
	isExpectationReadyToStartWorkingOn: async (exp: Expectation.Any): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready) return lookupSource
		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) return lookupTarget
		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		worker: GenericWorker
		// corePackageInfo: TMPCorePackageInfoInterface
	): Promise<{ fulfilled: boolean; reason: string }> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		/** undefined if all good, error string otherwise */
		// let reason: undefined | string = 'Unknown fulfill error'

		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const fullPath = lookupSource.foundPath
		// const fullPath = path.join(exp.startRequirement.location.folderPath, exp.startRequirement.content.filePath)

		// try {
		// 	await fsAccess(fullPath, fs.constants.R_OK)
		// 	// The file exists
		// } catch (err) {
		// 	return { fulfilled: false, reason: `File does not exist: ${err.toString()}` }
		// }
		const stat = await fsStat(fullPath)
		const statVersion = convertStatToVersion(stat)

		/** A string that should change whenever the file is changed */
		// const fileHash = hashObj(statVersion)

		const packageInfoSynced = await worker.corePackageInfoInterface.findUnUpdatedPackageInfo(
			'ffprobe',
			exp,
			exp.startRequirement.content,
			statVersion
		)
		if (packageInfoSynced.needsUpdate) {
			return { fulfilled: false, reason: packageInfoSynced.reason }
		} else {
			return { fulfilled: true, reason: packageInfoSynced.reason }
		}

		// if (!storedHash) {
		// 	return { fulfilled: false, reason: 'No Record found' }
		// } else if (storedHash !== fileHash) {
		// 	return { fulfilled: false, reason: `Record doesn't match file` }
		// } else {
		// 	return { fulfilled: true, reason: 'Record already matches file' }
		// }

		// return { fulfilled: false, reason: 'N/A' }
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the media file

		const lookupSource = await lookupSources(exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)
		if (!lookupSource.foundPath) throw new Error(`No source path found!`)

		const lookupTarget = await lookupTargets(exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)
		if (!lookupTarget.foundPath) throw new Error(`No target path found!`)

		let ffProbeProcess: ChildProcess | undefined
		const workInProgress = new WorkInProgress(async () => {
			// On cancel
			if (ffProbeProcess) {
				ffProbeProcess.kill() // todo: signal?
			}
		})

		setImmediate(() => {
			;(async () => {
				const startTime = Date.now()
				const sourcePath = lookupSource.foundPath
				// const fullPath = path.join( exp.startRequirement.location.folderPath, exp.startRequirement.content.filePath)

				try {
					await fsAccess(sourcePath, fs.constants.R_OK)
					// The file exists
				} catch (err) {
					workInProgress._reportError(err)
					return
				}

				const stat = await fsStat(sourcePath)
				const sourceVersion = convertStatToVersion(stat)
				const sourceVersionHash = hashObj(sourceVersion)

				// Use FFProbe to scan the file:
				const args = [
					process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
					'-hide_banner',
					`-i "${sourcePath}"`,
					'-show_streams',
					'-show_format',
					'-print_format',
					'json',
				]

				workInProgress._reportProgress(sourceVersionHash, 0.1)

				ffProbeProcess = exec(args.join(' '), (err, stdout, _stderr) => {
					// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
					ffProbeProcess = undefined
					if (err) {
						workInProgress._reportError(err)
						return
					}
					const json: any = JSON.parse(stdout)
					if (!json.streams || !json.streams[0]) {
						workInProgress._reportError(new Error(`File doesn't seem to be a media file`))
						return
					}

					worker.corePackageInfoInterface
						.updatePackageInfo('ffprobe', exp, exp.startRequirement.content, sourceVersion, json)
						.then(
							() => {
								const duration = Date.now() - startTime
								workInProgress._reportComplete(
									sourceVersionHash,
									`Scan completed in ${Math.round(duration / 100) / 10}s`,
									undefined
								)
							},
							(err) => {
								workInProgress._reportError(err)
							}
						)
				})
			})().catch((err) => {
				workInProgress._reportError(err)
			})
		})

		// workInProgress._reportError(err)

		return workInProgress
	},
	removeExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ removed: boolean; reason: string }> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		await worker.corePackageInfoInterface.removePackageInfo('ffprobe', exp)

		return { removed: true, reason: 'Removed scan info from Store' }
	},
}
function isMediaFileScan(exp: Expectation.Any): exp is Expectation.MediaFileScan {
	return exp.type === Expectation.Type.MEDIA_FILE_SCAN
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
async function lookupSources(exp: Expectation.MediaFileScan): Promise<LookupPackageContainer> {
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
				const filePath = accessor.filePath || exp.endRequirement.content.filePath
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
async function lookupTargets(exp: Expectation.MediaFileScan): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const packageContainer of exp.endRequirement.targets) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			if (accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO) {
				errorReason = undefined

				if (!errorReason) {
					// All good, no need to look further:
					return {
						foundPath: 'N/A',
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
