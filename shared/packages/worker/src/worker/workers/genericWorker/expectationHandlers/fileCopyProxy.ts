import { BaseWorker } from '../../../worker'
import { UniversalVersion, makeUniversalVersion, getStandardCost } from '../lib/lib'
import {
	Accessor,
	AccessorOnPackage,
	PackageContainerOnPackage,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	Reason,
	stringifyError,
	AccessorId,
	startTimer,
	KnownReason,
} from '@sofie-package-manager/api'
import {
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
	isQuantelClipAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import {
	checkWorkerHasAccessToPackageContainersOnPackage,
	lookupAccessorHandles,
	LookupPackageContainer,
	proxyFFMpegArguments,
} from './lib'
import { doFileCopyExpectation, isFileFulfilled, isFileReadyToStartWorkingOn } from './lib/file'
import { getSourceHTTPHandle } from './lib/quantel'
import { FFMpegProcess, spawnFFMpeg } from './lib/ffmpeg'
import { ExpectationHandlerGenericWorker } from '../genericWorker'

/**
 * Copies a file from one of the sources and into the target PackageContainer.
 * The result is intended to be a proxy, used for other operations such as scanning, thumbnail generation etc.
 */
export const FileCopyProxy: ExpectationHandlerGenericWorker = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: BaseWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isFileCopyProxy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isFileCopyProxy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		const lookupTarget = await lookupCopyTargets(worker, exp)

		return isFileReadyToStartWorkingOn(worker, lookupSource, lookupTarget)
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		_wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isFileCopyProxy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		const lookupSource = await lookupCopySources(worker, exp)

		return isFileFulfilled(worker, lookupSource, lookupTarget)
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isFileCopyProxy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		let workInProgress: WorkInProgress | null = null

		if (workInProgress === null) {
			const sourceHandle = lookupSource.handle
			const targetHandle = lookupTarget.handle

			const timer = startTimer()

			if (
				lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
				(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
					lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
					lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY)
			) {
				// We can read the source and write the preview directly.
				if (!isQuantelClipAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)
				if (
					!isLocalFolderAccessorHandle(targetHandle) &&
					!isFileShareAccessorHandle(targetHandle) &&
					!isHTTPProxyAccessorHandle(targetHandle)
				)
					throw new Error(`Target AccessHandler type is wrong`)

				// This is a bit special, as we use the Quantel HTTP-transformer to get a HLS-stream of the video, which we use to generate the proxy as a file on disk.

				const httpStreamURL = await sourceHandle.getTransformerStreamURL()
				if (!httpStreamURL.success) throw new Error(httpStreamURL.reason.tech)
				const sourceHTTPHandle = getSourceHTTPHandle(worker, exp.id, lookupSource.handle, httpStreamURL)

				let ffMpegProcess: FFMpegProcess | undefined
				const wip = new WorkInProgress({ workLabel: 'Generating preview' }, async () => {
					// On cancel
					ffMpegProcess?.cancel()
				}).do(async () => {
					const issueReadPackage = await sourceHandle.checkPackageReadAccess()
					if (!issueReadPackage.success) throw new Error(issueReadPackage.reason.tech)

					const actualSourceVersion = await sourceHandle.getPackageActualVersion()
					const actualSourceVersionHash = hashObj(actualSourceVersion)
					const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

					await targetHandle.removePackage('Prepare for copy')

					const fileOperation = await targetHandle.prepareForOperation('Copy proxy', sourceHTTPHandle)

					const args = proxyFFMpegArguments(sourceHTTPHandle.fullUrl, false, targetHandle)

					ffMpegProcess = await spawnFFMpeg(
						args,
						targetHandle,
						async () => {
							// Called when ffmpeg has finished
							worker.logger.debug(`FFMpeg finished [PID=${ffMpegProcess?.pid}]: ${args.join(' ')}`)
							ffMpegProcess = undefined

							await targetHandle.finalizePackage(fileOperation)
							await targetHandle.updateMetadata(actualSourceUVersion)

							const duration = timer.get()
							wip._reportComplete(
								actualSourceVersionHash,
								{
									user: `Preview generation completed in ${Math.round(duration / 100) / 10}s`,
									tech: `Completed at ${Date.now()}`,
								},
								undefined
							)
						},
						async (err) => {
							worker.logger.debug(
								`FFMpeg failed [PID=${ffMpegProcess?.pid}]: ${args.join(' ')}: ${stringifyError(err)}`
							)
							ffMpegProcess = undefined
							wip._reportError(err)
						},
						async (progress: number) => {
							wip._reportProgress(actualSourceVersionHash, progress)
						}
						// ,worker.logger.debug
					)
					worker.logger.debug(`FFMpeg started [PID=${ffMpegProcess.pid}]: ${args.join(' ')}`)
				})

				workInProgress = wip
			}
		}
		// Fallback:
		if (workInProgress === null) {
			workInProgress = await doFileCopyExpectation(exp, lookupSource, lookupTarget)
		}
		if (workInProgress === null) {
			throw new Error(
				`FileCopyProxy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		} else {
			return workInProgress
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isFileCopyProxy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) {
			return {
				removed: false,
				knownReason: lookupTarget.knownReason,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		}

		try {
			await lookupTarget.handle.removePackage(reason)
		} catch (err) {
			return {
				removed: false,
				knownReason: false,
				reason: {
					user: `Cannot remove file due to an internal error`,
					tech: `Cannot remove file: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
			// reason: `Removed file "${exp.endRequirement.content.filePath}" from target`
		}
	},
}
function isFileCopyProxy(exp: Expectation.Any): exp is Expectation.FileCopyProxy {
	return exp.type === Expectation.Type.FILE_COPY_PROXY
}

async function lookupCopySources(
	worker: BaseWorker,
	exp: Expectation.FileCopyProxy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.startRequirement.sources,
		{ expectationId: exp.id },
		exp.startRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.endRequirement.version,
			customCheck: checkAccessorForQuantelFiles,
		}
	)
}
async function lookupCopyTargets(
	worker: BaseWorker,
	exp: Expectation.FileCopyProxy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
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

function checkAccessorForQuantelFiles(
	_packageContainer: PackageContainerOnPackage,
	accessorId: AccessorId,
	accessor: AccessorOnPackage.Any
): { success: true } | { success: false; knownReason: KnownReason; reason: Reason } {
	if (accessor.type === Accessor.AccessType.QUANTEL) {
		// We need either a fileFlow or the quantel http transformer url to be set
		if (!accessor.fileflowURL && !accessor.transformerURL) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Accessor "${accessorId}" does not have a FileFlow nor a Transformer URL set.`,
					tech: `Accessor "${accessorId}" does not have a FileFlow nor a Transformer URL set.`,
				},
			}
		}
	}
	return {
		success: true,
	}
}
