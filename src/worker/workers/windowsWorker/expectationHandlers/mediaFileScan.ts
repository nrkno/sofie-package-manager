import { exec, ChildProcess } from 'child_process'
import { Accessor } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../../expectationApi'
import { findBestPackageContainerWithAccess } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { hashObj } from '../../../lib/lib'
import { isCorePackageInfoAccessorHandle, isLocalFolderHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { lookupAccessorHandles, LookupPackageContainer } from './lib'

export const MediaFileScan: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): { support: boolean; reason: string } {
		// Check that we have access to the packageContainer

		const accessSource = findBestPackageContainerWithAccess(genericWorker, exp.startRequirement.sources)
		if (accessSource) {
			return { support: true, reason: `Has access to source` }
		} else {
			return { support: false, reason: `Doesn't have access to any of the sources` }
		}
	},
	getCostForExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<number> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const accessSourcePackageContainer = findBestPackageContainerWithAccess(worker, exp.startRequirement.sources)

		const accessorTypeCost: { [key: string]: number } = {
			[Accessor.AccessType.LOCAL_FOLDER]: 1,
			[Accessor.AccessType.QUANTEL]: 1,
			[Accessor.AccessType.FILE_SHARE]: 2,
			[Accessor.AccessType.HTTP]: 3,
		}
		const sourceCost = accessSourcePackageContainer
			? 10 * accessorTypeCost[accessSourcePackageContainer.accessor.type as string] || 5
			: Number.POSITIVE_INFINITY

		return sourceCost
	},

	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupSource = await lookupScanSources(worker, exp)
		if (!lookupSource.ready) return lookupSource
		const lookupTarget = await lookupScanTargets(worker, exp)
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

		const lookupSource = await lookupScanSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupScanTargets(worker, exp)
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

		const lookupSource = await lookupScanSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupScanTargets(worker, exp)
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
		const lookupTarget = await lookupScanTargets(worker, exp)
		if (!lookupTarget.ready) return { removed: false, reason: `Not able to access target: ${lookupTarget.reason}` }
		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		await lookupTarget.handle.removePackageInfo('ffprobe', exp)

		return { removed: true, reason: 'Removed scan info from Store' }
	},
}
function isMediaFileScan(exp: Expectation.Any): exp is Expectation.MediaFileScan {
	return exp.type === Expectation.Type.MEDIA_FILE_SCAN
}
type Metadata = any // not used

function lookupScanSources(
	worker: GenericWorker,
	exp: Expectation.MediaFileScan
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(worker, exp.startRequirement.sources, exp.startRequirement.content, {
		read: true,
		readPackage: true,
		packageVersion: exp.startRequirement.version,
	})
}
function lookupScanTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFileScan
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(worker, exp.endRequirement.targets, exp.endRequirement.content, {
		write: true,
		writePackageContainer: true,
	})
}
