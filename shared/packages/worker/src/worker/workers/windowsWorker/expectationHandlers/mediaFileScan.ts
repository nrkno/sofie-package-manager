import { exec, ChildProcess } from 'child_process'
import { Accessor } from '@sofie-automation/blueprints-integration'
import { getStandardCost } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@shared/api'
import { isCorePackageInfoAccessorHandle, isLocalFolderAccessorHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { LocalFolderAccessorHandle } from '../../../accessorHandlers/localFolder'

/**
 * Scans the source media file and saves the result file into the target PackageContainer (a Sofie Core collection)
 */
export const MediaFileScan: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},

	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupScanSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupScanSources(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const issueReading = await lookupSource.handle.tryPackageRead()
		if (issueReading) return { ready: false, reason: issueReading }

		return {
			ready: true,
			sourceExists: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
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
			'scan',
			exp,
			exp.startRequirement.content,
			actualSourceVersion,
			exp.endRequirement.version
		)
		if (packageInfoSynced.needsUpdate) {
			if (wasFullfilled) {
				// Remove the outdated scan result:
				await lookupTarget.handle.removePackageInfo('scan', exp)
			}
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

		const currentProcess: {
			abort?: () => void
		} = {}
		const workInProgress = new WorkInProgress({ workLabel: 'Scanning file' }, async () => {
			// On cancel
			if (currentProcess.abort) {
				currentProcess.abort()
			}
		}).do(async () => {
			const sourceHandle = lookupSource.handle
			const targetHandle = lookupTarget.handle
			if (
				lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
				lookupTarget.accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO
			) {
				if (!isLocalFolderAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)
				if (!isCorePackageInfoAccessorHandle(targetHandle))
					throw new Error(`Target AccessHandler type is wrong`)

				const issueReadPackage = await sourceHandle.checkPackageReadAccess()
				if (issueReadPackage) throw new Error(issueReadPackage)

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const sourceVersionHash = hashObj(actualSourceVersion)

				workInProgress._reportProgress(sourceVersionHash, 0.1)

				// Scan with FFProbe:
				const ffProbe = scanWithFFProbe(sourceHandle)
				currentProcess.abort = ffProbe.abort
				const json = await ffProbe.promise
				workInProgress._reportProgress(sourceVersionHash, 0.33)
				currentProcess.abort = undefined

				// all done:
				await targetHandle.updatePackageInfo(
					'scan',
					exp,
					exp.startRequirement.content,
					actualSourceVersion,
					exp.endRequirement.version,
					json
				)

				const duration = Date.now() - startTime
				workInProgress._reportComplete(
					sourceVersionHash,
					`Scan completed in ${Math.round(duration / 100) / 10}s`,
					undefined
				)
			} else {
				throw new Error(
					`MediaFileScan.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
				)
			}
		})

		return workInProgress
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFileScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupScanTargets(worker, exp)
		if (!lookupTarget.ready) return { removed: false, reason: `Not able to access target: ${lookupTarget.reason}` }
		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		await lookupTarget.handle.removePackageInfo('scan', exp)

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
	return lookupAccessorHandles<Metadata>(
		worker,
		exp.startRequirement.sources,
		exp.startRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.startRequirement.version,
		}
	)
}
function lookupScanTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFileScan
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(
		worker,
		exp.endRequirement.targets,
		exp.endRequirement.content,
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}

export function scanWithFFProbe(
	sourceHandle: LocalFolderAccessorHandle<any>
): { promise: Promise<any>; abort: () => void } {
	// Use FFProbe to scan the file:
	const args = [
		process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
		'-hide_banner',
		`-i "${sourceHandle.fullPath}"`,
		'-show_streams',
		'-show_format',
		'-print_format',
		'json',
	]
	let ffProbeProcess: ChildProcess | undefined = undefined

	const promise = new Promise((resolve, reject) => {
		ffProbeProcess = exec(args.join(' '), (err, stdout, _stderr) => {
			// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
			ffProbeProcess = undefined
			if (err) {
				reject(err)
				return
			}
			const json: any = JSON.parse(stdout)
			if (!json.streams || !json.streams[0]) {
				reject(new Error(`File doesn't seem to be a media file`))
				return
			}
			resolve(json)
		})
	})
	return {
		promise,
		abort: () => {
			if (ffProbeProcess) {
				ffProbeProcess.kill() // todo: signal?
			}
		},
	}
}
