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
import {
	isCorePackageInfoAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isLocalFolderAccessorHandle,
	isQuantelClipAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { DeepScanResult } from './lib/coreApi'
import { CancelablePromise } from '../../../lib/cancelablePromise'
import { scanFieldOrder, scanMoreInfo, scanWithFFProbe } from './lib/scan'

/**
 * Performs a "deep scan" of the source package and saves the result file into the target PackageContainer (a Sofie Core collection)
 * The "deep scan" differs from the usual scan in that it does things that takes a bit longer, like scene-detection, field order detection etc..
 */
export const PackageDeepScan: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
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
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		const packageInfoSynced = await lookupTarget.handle.findUnUpdatedPackageInfo(
			'deepScan',
			exp,
			exp.startRequirement.content,
			actualSourceVersion,
			exp.endRequirement.version
		)
		if (packageInfoSynced.needsUpdate) {
			if (wasFullfilled) {
				// Remove the outdated scan result:
				await lookupTarget.handle.removePackageInfo('deepScan', exp)
			}
			return { fulfilled: false, reason: packageInfoSynced.reason }
		} else {
			return { fulfilled: true, reason: packageInfoSynced.reason }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the source media file and upload the results to Core
		const startTime = Date.now()

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		let currentProcess: CancelablePromise<any> | undefined
		const workInProgress = new WorkInProgress({ workLabel: 'Scanning file' }, async () => {
			// On cancel
			currentProcess?.cancel()
		}).do(async () => {
			const sourceHandle = lookupSource.handle
			const targetHandle = lookupTarget.handle
			if (
				(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
					lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
					lookupSource.accessor.type === Accessor.AccessType.HTTP ||
					lookupSource.accessor.type === Accessor.AccessType.QUANTEL) &&
				lookupTarget.accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO
			) {
				if (
					!isLocalFolderAccessorHandle(sourceHandle) &&
					!isFileShareAccessorHandle(sourceHandle) &&
					!isHTTPAccessorHandle(sourceHandle) &&
					!isQuantelClipAccessorHandle(sourceHandle)
				)
					throw new Error(`Source AccessHandler type is wrong`)

				if (!isCorePackageInfoAccessorHandle(targetHandle))
					throw new Error(`Target AccessHandler type is wrong`)

				const issueReadPackage = await sourceHandle.checkPackageReadAccess()
				if (issueReadPackage) throw new Error(issueReadPackage)

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const sourceVersionHash = hashObj(actualSourceVersion)

				workInProgress._reportProgress(sourceVersionHash, 0.1)

				// Scan with FFProbe:
				currentProcess = scanWithFFProbe(sourceHandle)
				const ffProbeScan = await currentProcess
				workInProgress._reportProgress(sourceVersionHash, 0.2)
				currentProcess = undefined

				// Scan field order:
				currentProcess = scanFieldOrder(sourceHandle, exp.endRequirement.version)
				const resultFieldOrder = await currentProcess
				workInProgress._reportProgress(sourceVersionHash, 0.5)
				currentProcess = undefined

				// Scan more info:
				currentProcess = scanMoreInfo(sourceHandle, ffProbeScan, exp.endRequirement.version, (progress) => {
					workInProgress._reportProgress(sourceVersionHash, 0.5 + 0.4 * progress)
				})
				const { blacks: resultBlacks, freezes: resultFreezes, scenes: resultScenes } = await currentProcess
				workInProgress._reportProgress(sourceVersionHash, 0.99)
				currentProcess = undefined

				const deepScan: DeepScanResult = {
					field_order: resultFieldOrder,
					blacks: resultBlacks,
					freezes: resultFreezes,
					scenes: resultScenes,
				}

				// all done:
				await targetHandle.updatePackageInfo(
					'deepScan',
					exp,
					exp.startRequirement.content,
					actualSourceVersion,
					exp.endRequirement.version,
					deepScan
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
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready) return { removed: false, reason: `Not able to access target: ${lookupTarget.reason}` }
		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		await lookupTarget.handle.removePackageInfo('deepScan', exp)

		return { removed: true, reason: 'Removed scan info from Store' }
	},
}
function isPackageDeepScan(exp: Expectation.Any): exp is Expectation.PackageDeepScan {
	return exp.type === Expectation.Type.PACKAGE_DEEP_SCAN
}
type Metadata = any // not used

function lookupDeepScanSources(
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
function lookupDeepScanTargets(
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
