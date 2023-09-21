import { getStandardCost } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	Accessor,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	stringifyError,
} from '@sofie-package-manager/api'
import { isCorePackageInfoAccessorHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { DeepScanResult, FieldOrder, PackageInfoType, ScanAnomaly } from './lib/coreApi'
import { CancelablePromise } from '../../../lib/cancelablePromise'
import {
	FFProbeScanResult,
	isAnFFMpegSupportedSourceAccessor,
	isAnFFMpegSupportedSourceAccessorHandle,
	scanFieldOrder,
	scanMoreInfo,
	scanWithFFProbe,
} from './lib/scan'
import { WindowsWorker } from '../windowsWorker'

/**
 * Performs a "deep scan" of the source package and saves the result file into the target PackageContainer (a Sofie Core collection)
 * The "deep scan" differs from the usual scan in that it does things that takes a bit longer, like scene-detection, field order detection etc..
 */
export const PackageDeepScan: ExpectationWindowsHandler = {
	doYouSupportExpectation(
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	): ReturnTypeDoYouSupportExpectation {
		if (windowsWorker.testFFMpeg)
			return {
				support: false,
				reason: {
					user: 'There is an issue with the Worker (FFMpeg)',
					tech: `Cannot access FFMpeg executable: ${windowsWorker.testFFMpeg}`,
				},
			}
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},

	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupDeepScanSources(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success)
			return { ready: false, sourceExists: tryReading.packageExists, reason: tryReading.reason }

		return {
			ready: true,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access source, due to ${lookupSource.reason.user}`,
					tech: `Not able to access source: ${lookupSource.reason.tech}`,
				},
			}
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access target, due to ${lookupTarget.reason.user}`,
					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
				},
			}

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		const packageInfoSynced = await lookupTarget.handle.findUnUpdatedPackageInfo(
			PackageInfoType.DeepScan,
			exp,
			exp.startRequirement.content,
			actualSourceVersion,
			exp.endRequirement.version
		)
		if (packageInfoSynced.needsUpdate) {
			if (wasFullfilled) {
				// Remove the outdated scan result:
				await lookupTarget.handle.removePackageInfo(PackageInfoType.DeepScan, exp)
			}
			return { fulfilled: false, reason: packageInfoSynced.reason }
		} else {
			return { fulfilled: true }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the source media file and upload the results to Core
		const startTime = Date.now()

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		let currentProcess: CancelablePromise<any> | undefined
		const workInProgress = new WorkInProgress({ workLabel: 'Deep Scanning file' }, async () => {
			// On cancel
			currentProcess?.cancel()
		}).do(async () => {
			const sourceHandle = lookupSource.handle
			const targetHandle = lookupTarget.handle
			if (
				!isAnFFMpegSupportedSourceAccessor(lookupSource.accessor) ||
				lookupTarget.accessor.type !== Accessor.AccessType.CORE_PACKAGE_INFO
			)
				throw new Error(
					`PackageDeepScan.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
				)

			if (!isAnFFMpegSupportedSourceAccessorHandle(sourceHandle))
				throw new Error(`Source AccessHandler type is wrong`)

			if (!isCorePackageInfoAccessorHandle(targetHandle)) throw new Error(`Target AccessHandler type is wrong`)

			const tryReadPackage = await sourceHandle.checkPackageReadAccess()
			if (!tryReadPackage.success) throw new Error(tryReadPackage.reason.tech)

			const actualSourceVersion = await sourceHandle.getPackageActualVersion()
			const sourceVersionHash = hashObj(actualSourceVersion)

			workInProgress._reportProgress(sourceVersionHash, 0.01)

			// Scan with FFProbe:
			currentProcess = scanWithFFProbe(sourceHandle)
			const ffProbeScan: FFProbeScanResult = await currentProcess
			const hasVideoStream =
				ffProbeScan.streams && ffProbeScan.streams.some((stream) => stream.codec_type === 'video')
			workInProgress._reportProgress(sourceVersionHash, 0.1)
			currentProcess = undefined

			// Scan field order:
			let resultFieldOrder = FieldOrder.Unknown
			if (hasVideoStream) {
				currentProcess = scanFieldOrder(sourceHandle, exp.endRequirement.version)
				resultFieldOrder = await currentProcess
				currentProcess = undefined
			}
			workInProgress._reportProgress(sourceVersionHash, 0.2)

			// Scan more info:
			let resultBlacks: ScanAnomaly[] = []
			let resultFreezes: ScanAnomaly[] = []
			let resultScenes: number[] = []
			if (hasVideoStream) {
				currentProcess = scanMoreInfo(
					sourceHandle,
					ffProbeScan,
					exp.endRequirement.version,
					(progress) => {
						workInProgress._reportProgress(sourceVersionHash, 0.21 + 0.77 * progress)
					},
					worker.logger.category('scanMoreInfo')
				)
				const result = await currentProcess
				resultBlacks = result.blacks
				resultFreezes = result.freezes
				resultScenes = result.scenes
				currentProcess = undefined
			}
			workInProgress._reportProgress(sourceVersionHash, 0.99)

			const deepScan: DeepScanResult = {
				field_order: resultFieldOrder,
				blacks: resultBlacks,
				freezes: resultFreezes,
				scenes: resultScenes,
			}

			// all done:
			const scanOperation = await targetHandle.prepareForOperation('Deep scan', sourceHandle)
			await targetHandle.updatePackageInfo(
				PackageInfoType.DeepScan,
				exp,
				exp.startRequirement.content,
				actualSourceVersion,
				exp.endRequirement.version,
				deepScan
			)

			await targetHandle.finalizePackage(scanOperation)

			const duration = Date.now() - startTime
			workInProgress._reportComplete(
				sourceVersionHash,
				{
					user: `Scan completed in ${Math.round(duration / 100) / 10}s`,
					tech: `Completed at ${Date.now()}`,
				},
				undefined
			)
		})

		return workInProgress
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				removed: false,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		try {
			await lookupTarget.handle.removePackageInfo(PackageInfoType.DeepScan, exp)
		} catch (err) {
			return {
				removed: false,
				reason: {
					user: `Cannot remove the scan result due to an internal error`,
					tech: `Cannot remove CorePackageInfo: ${stringifyError(err)}`,
				},
			}
		}

		return { removed: true }
	},
}
function isPackageDeepScan(exp: Expectation.Any): exp is Expectation.PackageDeepScan {
	return exp.type === Expectation.Type.PACKAGE_DEEP_SCAN
}
type Metadata = any // not used

async function lookupDeepScanSources(
	worker: GenericWorker,
	exp: Expectation.PackageDeepScan
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
async function lookupDeepScanTargets(
	worker: GenericWorker,
	exp: Expectation.PackageDeepScan
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
