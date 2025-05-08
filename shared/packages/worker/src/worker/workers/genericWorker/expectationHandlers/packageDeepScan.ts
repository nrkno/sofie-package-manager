import { getStandardCost } from '../lib/lib'
import { BaseWorker } from '../../../worker'
import {
	Accessor,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	stringifyError,
	startTimer,
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
import { ExpectationHandlerGenericWorker, GenericWorker } from '../genericWorker'

/**
 * Performs a "deep scan" of the source package and saves the result file into the target PackageContainer (a Sofie Core collection)
 * The "deep scan" differs from the usual scan in that it does things that takes a bit longer, like scene-detection, field order detection etc..
 */
export const PackageDeepScan: ExpectationHandlerGenericWorker = {
	doYouSupportExpectation(exp: Expectation.Any, worker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		if (worker.testFFMpeg)
			return {
				support: false,
				knownReason: true,
				reason: {
					user: 'There is an issue with the Worker (FFMpeg)',
					tech: `Cannot access FFMpeg executable: ${worker.testFFMpeg}`,
				},
			}
		if (worker.testFFProbe)
			return {
				support: false,
				knownReason: true,
				reason: {
					user: 'There is an issue with the Worker (FFProbe)',
					tech: `Cannot access FFProbe executable: ${worker.testFFProbe}`,
				},
			}
		return checkWorkerHasAccessToPackageContainersOnPackage(worker, {
			sources: exp.startRequirement.sources,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},

	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready)
			return {
				ready: lookupSource.ready,
				knownReason: lookupSource.knownReason,
				sourceExists: false,
				reason: lookupSource.reason,
			}
		const lookupTarget = await lookupDeepScanSources(worker, exp)
		if (!lookupTarget.ready)
			return { ready: lookupTarget.ready, knownReason: lookupTarget.knownReason, reason: lookupTarget.reason }

		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success)
			return {
				ready: false,
				knownReason: tryReading.knownReason,
				sourceExists: tryReading.packageExists,
				reason: tryReading.reason,
			}

		return {
			ready: true,
		}
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready)
			return {
				fulfilled: false,
				knownReason: lookupSource.knownReason,
				reason: {
					user: `Not able to access source, due to ${lookupSource.reason.user}`,
					tech: `Not able to access source: ${lookupSource.reason.tech}`,
				},
			}
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				knownReason: lookupTarget.knownReason,
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
			if (wasFulfilled) {
				// Remove the outdated scan result:
				await lookupTarget.handle.removePackageInfo(
					PackageInfoType.DeepScan,
					exp,
					'in isExpectationFulfilled, needsUpdate'
				)
			}
			return { fulfilled: false, knownReason: true, reason: packageInfoSynced.reason }
		} else {
			return { fulfilled: true }
		}
	},
	workOnExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker,
		progressTimeout: number
	): Promise<IWorkInProgress> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the source media file and upload the results to Core
		const timer = startTimer()

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
				let hasGottenProgress = false

				currentProcess = new CancelablePromise<{
					scenes: number[]
					freezes: ScanAnomaly[]
					blacks: ScanAnomaly[]
				}>(async (resolve, reject, onCancel) => {
					let isDone = false
					let ignoreNextCancelError = false

					const scanMoreInfoProcess = scanMoreInfo(
						sourceHandle,
						ffProbeScan,
						exp.endRequirement.version,
						(progress) => {
							hasGottenProgress = true
							workInProgress._reportProgress(sourceVersionHash, 0.21 + 0.77 * progress)
						},
						worker.logger.category('scanMoreInfo')
					)
					onCancel(() => {
						scanMoreInfoProcess.cancel()
					})

					scanMoreInfoProcess.then(
						(result) => {
							isDone = true
							resolve(result)
						},
						(error) => {
							if (`${error}`.match(/cancelled/i) && ignoreNextCancelError) {
								// ignore this
								ignoreNextCancelError = false
							} else {
								reject(error)
							}
						}
					)

					// Guard against an edge case where we don't get any progress reports:
					setTimeout(() => {
						if (!isDone && currentProcess && !hasGottenProgress) {
							// If we haven't gotten any progress yet, we probably won't get any.

							// 2023-09-20: There seems to be some bug in the FFMpeg scan where it won't output any progress
							// if the scene detection is on.
							// Let's abort and try again without scene detection:

							ignoreNextCancelError = true
							currentProcess.cancel()

							const scanMoreInfoProcessSecondTry = scanMoreInfo(
								sourceHandle,
								ffProbeScan,
								{
									...exp.endRequirement.version,
									scenes: false, // no scene detection
								},
								(progress) => {
									hasGottenProgress = true
									workInProgress._reportProgress(sourceVersionHash, 0.21 + 0.77 * progress)
								},
								worker.logger.category('scanMoreInfo')
							)

							scanMoreInfoProcessSecondTry.then(
								(result) => resolve(result),
								(error) => reject(error)
							)
						}
					}, progressTimeout * 0.5)
				})

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

			const duration = timer.get()
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
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isPackageDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				removed: false,
				knownReason: lookupTarget.knownReason,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		try {
			await lookupTarget.handle.removePackageInfo(PackageInfoType.DeepScan, exp, reason)
		} catch (err) {
			return {
				removed: false,
				knownReason: false,
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
	worker: BaseWorker,
	exp: Expectation.PackageDeepScan
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(
		worker,
		exp.startRequirement.sources,
		{ expectationId: exp.id },
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
	worker: BaseWorker,
	exp: Expectation.PackageDeepScan
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(
		worker,
		exp.endRequirement.targets,
		{ expectationId: exp.id },
		exp.endRequirement.content,
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}
