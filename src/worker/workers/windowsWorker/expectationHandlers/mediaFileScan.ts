import { exec, ChildProcess } from 'child_process'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../../expectationApi'
import { compareActualExpectVersions } from '../lib/lib'
import { GenericWorker, IWorkInProgress, WorkInProgress } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { hashObj } from '../../../lib/lib'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import {
	getAccessorHandle,
	isCorePackageInfoAccessorHandle,
	isLocalFolderHandle,
} from '../../../accessorHandlers/accessor'

export const MediaFileScan: ExpectationWindowsHandler = {
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) return lookupSource
		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) return lookupTarget
		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ fulfilled: boolean; reason: string }> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		/** undefined if all good, error string otherwise */
		// let reason: undefined | string = 'Unknown fulfill error'

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		const packageInfoSynced = await lookupTarget.handle.findUnUpdatedPackageInfo(
			'ffprobe',
			exp,
			exp.startRequirement.content,
			actualSourceVersion
		)
		if (packageInfoSynced.needsUpdate) {
			return { fulfilled: false, reason: packageInfoSynced.reason }
		} else {
			return { fulfilled: true, reason: packageInfoSynced.reason }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the source media file and upload the results to Core
		const startTime = Date.now()

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		let ffProbeProcess: ChildProcess | undefined
		const workInProgress = new WorkInProgress(async () => {
			// On cancel
			if (ffProbeProcess) {
				ffProbeProcess.kill() // todo: signal?
			}
		})
		if (
			lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
			lookupTarget.accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO
		) {
			if (!isLocalFolderHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
			if (!isCorePackageInfoAccessorHandle(lookupTarget.handle))
				throw new Error(`Target AccessHandler type is wrong`)

			const targetHandle = lookupTarget.handle

			const issueReadPackage = await lookupSource.handle.checkPackageReadAccess()
			if (issueReadPackage) {
				workInProgress._reportError(new Error(issueReadPackage))
			} else {
				const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
				const sourceVersionHash = hashObj(actualSourceVersion)

				// Use FFProbe to scan the file:
				const args = [
					process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
					'-hide_banner',
					`-i "${lookupSource.handle.fullPath}"`,
					'-show_streams',
					'-show_format',
					'-print_format',
					'json',
				]
				// Report back an initial status, because it looks nice:
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
					targetHandle
						.updatePackageInfo('ffprobe', exp, exp.startRequirement.content, actualSourceVersion, json)
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
			}
		} else {
			throw new Error(
				`MediaFileScan.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}

		return workInProgress
	},
	removeExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ removed: boolean; reason: string }> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) return { removed: false, reason: `Not able to access target: ${lookupTarget.reason}` }
		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		await lookupTarget.handle.removePackageInfo('ffprobe', exp)

		return { removed: true, reason: 'Removed scan info from Store' }
	},
}
function isMediaFileScan(exp: Expectation.Any): exp is Expectation.MediaFileScan {
	return exp.type === Expectation.Type.MEDIA_FILE_SCAN
}

type LookupPackageContainer =
	| {
			accessor: AccessorOnPackage.Any
			handle: GenericAccessorHandle<any>
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
async function lookupSources(worker: GenericWorker, exp: Expectation.MediaFileScan): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No source found'

	// See if the file is available at any of the sources:
	for (const packageContainer of exp.startRequirement.sources) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle(worker, accessor, exp.startRequirement.content)

			const issueAccessor = handle.checkHandleRead()
			if (issueAccessor) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueAccessor}`
				continue // Maybe next source works?
			}
			// Check that the file is of the right version:
			const issuePackageContainer = await handle.checkPackageReadAccess()
			if (issuePackageContainer) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issuePackageContainer}`
				continue // Maybe next source works?
			}

			const actualSourceVersion = await handle.getPackageActualVersion()
			const fileVersionReason = compareActualExpectVersions(actualSourceVersion, exp.startRequirement.version)
			if (fileVersionReason) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${fileVersionReason}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
					accessor: accessor,
					handle: handle,
					ready: true,
					reason: `Can access source "${packageContainer.label}" through accessor "${accessorId}"`,
				}
			}
		}
	}
	return {
		accessor: undefined,
		handle: undefined,
		ready: false,
		reason: errorReason,
	}
}

/** Check that we have any access to a Package on an target-packageContainer, then return the packageContainer */
async function lookupTargets(worker: GenericWorker, exp: Expectation.MediaFileScan): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const packageContainer of exp.endRequirement.targets) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle(worker, accessor, exp.endRequirement.content)

			const issueAccessor = handle.checkHandleWrite()
			if (issueAccessor) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueAccessor}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
					accessor: accessor,
					handle: handle,
					ready: true,
					reason: `Can access target "${packageContainer.label}" through accessor "${accessorId}"`,
				}
			}
		}
	}
	return {
		accessor: undefined,
		handle: undefined,
		ready: false,
		reason: errorReason,
	}
}
