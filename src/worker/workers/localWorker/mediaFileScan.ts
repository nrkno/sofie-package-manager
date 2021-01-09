import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { exec, ChildProcess } from 'child_process'
import { PackageOrigin } from '@sofie-automation/blueprints-integration'
import { hashObj } from '../../lib/lib'
import { Expectation } from '../../../worker/expectationApi'
import { compareFileVersion, convertStatToVersion } from './lib'
import { TMPCorePackageInfoInterface } from './localWorker'
import { IWorkInProgress, WorkInProgress } from '../../../worker/worker'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)

export async function isExpectationReadyToStartWorkingOn(
	exp: Expectation.MediaFileScan
): Promise<{ ready: boolean; reason?: string }> {
	if (exp.startRequirement.location.type === PackageOrigin.OriginType.LOCAL_FOLDER) {
		const fullPath = path.join(exp.startRequirement.location.folderPath, exp.startRequirement.content.filePath)

		try {
			await fsAccess(fullPath, fs.constants.R_OK)
			// The file exists
		} catch (err) {
			return { ready: false, reason: `File does not exist: ${err.toString()}` }
		}

		// check that the file is of the right version:
		const stat = await fsStat(fullPath)
		const errorReason = compareFileVersion(stat, exp.startRequirement.version)
		if (errorReason) return { ready: false, reason: errorReason }

		return { ready: true, reason: '' }
	} else {
		// console.log('exp.startRequirement.location', exp.startRequirement.location)
		throw new Error(`Unsupported location type "${exp.startRequirement.location.type}"`)
	}

	// const lookupOrigin = await lookupExpOrigin(exp)
}
export async function isExpectationFullfilled(
	exp: Expectation.MediaFileScan,
	corePackageInfo: TMPCorePackageInfoInterface
): Promise<{ fulfilled: boolean; reason?: string }> {
	/** undefined if all good, error string otherwise */
	// let reason: undefined | string = 'Unknown fulfill error'

	const fullPath = path.join(exp.startRequirement.location.folderPath, exp.startRequirement.content.filePath)

	try {
		await fsAccess(fullPath, fs.constants.R_OK)
		// The file exists
	} catch (err) {
		return { fulfilled: false, reason: `File does not exist: ${err.toString()}` }
	}
	const stat = await fsStat(fullPath)
	const statVersion = convertStatToVersion(stat)

	if (exp.endRequirement.location.type === PackageOrigin.OriginType.CORE_PACKAGE_INFO) {
		/** A string that should change whenever the file is changed */
		const fileHash = hashObj(statVersion)

		const storedHash = await corePackageInfo.fetchPackageInfoHash(
			exp.startRequirement.location,
			exp.startRequirement.content,
			exp.startRequirement.version
		)

		if (!storedHash) {
			return { fulfilled: false, reason: 'No Record found' }
		} else if (storedHash !== fileHash) {
			return { fulfilled: false, reason: `Record doesn't match file` }
		} else {
			return { fulfilled: true, reason: 'Record matches file' }
		}
	} else {
		throw new Error(`Unsupported location type "${exp.endRequirement.location.type}"`)
	}

	// return { fulfilled: false, reason: 'N/A' }
}
export async function workOnExpectation(
	exp: Expectation.MediaFileScan,
	corePackageInfo: TMPCorePackageInfoInterface
): Promise<IWorkInProgress> {
	// Scan the media file

	let ffProbeProcess: ChildProcess | undefined
	const workInProgress = new WorkInProgress(async () => {
		// On cancel
		if (ffProbeProcess) {
			ffProbeProcess.kill() // todo: signal?
		}
	})

	setImmediate(() => {
		;(async () => {
			const fullPath = path.join(exp.startRequirement.location.folderPath, exp.startRequirement.content.filePath)

			try {
				await fsAccess(fullPath, fs.constants.R_OK)
				// The file exists
			} catch (err) {
				workInProgress._reportError(err.toString())
				return
			}

			const stat = await fsStat(fullPath)
			const statVersion = convertStatToVersion(stat)
			const fileHash = hashObj(statVersion)

			// Use FFProbe to scan the file:
			const args = [
				process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
				'-hide_banner',
				`-i "${fullPath}"`,
				'-show_streams',
				'-show_format',
				'-print_format',
				'json',
			]
			console.log('Starting ffprobe')
			ffProbeProcess = exec(args.join(' '), (err, stdout, _stderr) => {
				// console.log(stdout)
				// console.log(stderr)
				// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
				ffProbeProcess = undefined
				if (err) {
					workInProgress._reportError(err.toString())
					return
				}
				const json: any = JSON.parse(stdout)
				if (!json.streams || !json.streams[0]) {
					workInProgress._reportError(`File doesn't seem to be a media file`)
					return
				}

				corePackageInfo
					.storePackageInfo(
						exp.startRequirement.location,
						exp.startRequirement.content,
						exp.startRequirement.version,
						fileHash,
						json
					)
					.then(
						() => {
							workInProgress._reportComplete(undefined)
						},
						(err) => {
							workInProgress._reportError(err.toString())
						}
					)
			})
		})().catch((err) => {
			workInProgress._reportError(err.toString())
		})
	})

	// workInProgress._reportError(err)

	return workInProgress
}
export async function removeExpectation(
	exp: Expectation.MediaFileScan,
	corePackageInfo: TMPCorePackageInfoInterface
): Promise<{ removed: boolean; reason?: string }> {
	// todo: remove from corePackageInfo
	// corePackageInfo

	await corePackageInfo.removePackageInfo(
		exp.startRequirement.location,
		exp.startRequirement.content,
		exp.startRequirement.version
	)

	return { removed: true, reason: '' }
}
