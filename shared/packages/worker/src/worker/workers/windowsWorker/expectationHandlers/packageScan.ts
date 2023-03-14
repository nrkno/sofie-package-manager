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
	stringifyError,
} from '@sofie-package-manager/api'
import { Accessor } from '@sofie-package-manager/input-api'
import { isCorePackageInfoAccessorHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { CancelablePromise } from '../../../lib/cancelablePromise'
import { isAnFFMpegSupportedSourceAccessor, isAnFFMpegSupportedSourceAccessorHandle, scanWithFFProbe } from './lib/scan'
import { WindowsWorker } from '../windowsWorker'
import { PackageInfoType } from './lib/coreApi'

/**
 * Scans the source package and saves the result file into the target PackageContainer (a Sofie Core collection)
 */
export const PackageScan: ExpectationWindowsHandler = {
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
		if (!isPackageScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},

	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isPackageScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupScanSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupScanSources(worker, exp)
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
		if (!isPackageScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupScanSources(worker, exp)
		if (!lookupSource.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access source, due to ${lookupSource.reason.user}`,
					tech: `Not able to access source: ${lookupSource.reason.tech}`,
				},
			}
		const lookupTarget = await lookupScanTargets(worker, exp)
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
			PackageInfoType.Scan,
			exp,
			exp.startRequirement.content,
			actualSourceVersion,
			exp.endRequirement.version
		)
		if (packageInfoSynced.needsUpdate) {
			if (wasFullfilled) {
				// Remove the outdated scan result:
				await lookupTarget.handle.removePackageInfo(PackageInfoType.Scan, exp)
			}
			return { fulfilled: false, reason: packageInfoSynced.reason }
		} else {
			return { fulfilled: true }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isPackageScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the source package and upload the results to Core
		const startTime = Date.now()

		const lookupSource = await lookupScanSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupScanTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		let currentProcess: CancelablePromise<any> | undefined
		const workInProgress = new WorkInProgress({ workLabel: 'Scanning file' }, async () => {
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
					`PackageScan.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
				)

			if (!isAnFFMpegSupportedSourceAccessorHandle(sourceHandle))
				throw new Error(`Source AccessHandler type is wrong`)

			if (!isCorePackageInfoAccessorHandle(targetHandle)) throw new Error(`Target AccessHandler type is wrong`)

			const tryReadPackage = await sourceHandle.checkPackageReadAccess()
			if (!tryReadPackage.success) throw new Error(tryReadPackage.reason.tech)

			const actualSourceVersion = await sourceHandle.getPackageActualVersion()
			const sourceVersionHash = hashObj(actualSourceVersion)

			workInProgress._reportProgress(sourceVersionHash, 0.1)

			// Scan with FFProbe:
			currentProcess = scanWithFFProbe(sourceHandle)
			const scanResult = await currentProcess
			workInProgress._reportProgress(sourceVersionHash, 0.5)
			currentProcess = undefined

			// all done:
			await targetHandle.packageIsInPlace()
			await targetHandle.updatePackageInfo(
				PackageInfoType.Scan,
				exp,
				exp.startRequirement.content,
				actualSourceVersion,
				exp.endRequirement.version,
				scanResult
			)

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
		if (!isPackageScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupScanTargets(worker, exp)
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
			await lookupTarget.handle.removePackageInfo(PackageInfoType.Scan, exp)
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
function isPackageScan(exp: Expectation.Any): exp is Expectation.PackageScan {
	return exp.type === Expectation.Type.PACKAGE_SCAN
}
type Metadata = any // not used

async function lookupScanSources(
	worker: GenericWorker,
	exp: Expectation.PackageScan
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
async function lookupScanTargets(
	worker: GenericWorker,
	exp: Expectation.PackageScan
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
