import { BaseWorker } from '../../../worker'
import { getStandardCost } from '../lib/lib'
import {
	Accessor,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	assertNever,
	stringifyError,
	startTimer,
} from '@sofie-package-manager/api'
import {
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import {
	checkWorkerHasAccessToPackageContainersOnPackage,
	lookupAccessorHandles,
	LookupPackageContainer,
	previewFFMpegArguments,
} from './lib'
import { FFMpegProcess, spawnFFMpeg } from './lib/ffmpeg'
import { ExpectationHandlerGenericWorker, GenericWorker } from '../genericWorker'
import { scanWithFFProbe, FFProbeScanResult } from './lib/scan'
import { CancelablePromise } from '../../../lib/cancelablePromise'

/**
 * Generates a low-res preview video of a source video file, and stores the resulting file into the target PackageContainer
 */
export const MediaFilePreview: ExpectationHandlerGenericWorker = {
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
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready)
			return {
				ready: lookupSource.ready,
				knownReason: lookupSource.knownReason,
				sourceExists: false,
				reason: lookupSource.reason,
			}
		const lookupTarget = await lookupPreviewTargets(worker, exp)
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
		_wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready)
			return {
				fulfilled: false,
				knownReason: lookupSource.knownReason,
				reason: {
					user: `Not able to access source, due to ${lookupSource.reason.user}`,
					tech: `Not able to access source: ${lookupSource.reason.tech}`,
				},
			}
		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				knownReason: lookupTarget.knownReason,
				reason: {
					user: `Not able to access target, due to ${lookupTarget.reason.user}`,
					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
				},
			}

		const issueReadPackage = await lookupTarget.handle.checkPackageReadAccess()
		if (!issueReadPackage.success)
			return {
				fulfilled: false,
				knownReason: issueReadPackage.knownReason,
				reason: {
					user: `Issue with target: ${issueReadPackage.reason.user}`,
					tech: `Issue with target: ${issueReadPackage.reason.tech}`,
				},
			}

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)

		const metadata = await lookupTarget.handle.fetchMetadata()

		if (!metadata) {
			return {
				fulfilled: false,
				knownReason: true,
				reason: { user: `The preview needs to be re-generated`, tech: `No preview metadata file found` },
			}
		} else if (metadata.sourceVersionHash !== actualSourceVersionHash) {
			return {
				fulfilled: false,
				knownReason: true,
				reason: {
					user: `The preview needs to be re-generated`,
					tech: `Preview version doesn't match source file`,
				},
			}
		} else {
			return {
				fulfilled: true,
				// reason: { user: `Preview already matches preview file`, tech: `Preview already matches preview file` },
			}
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const timer = startTimer()

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle

		if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP_PROXY) &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY)
		) {
			// We can read the source and write the preview directly.
			if (
				!isLocalFolderAccessorHandle(sourceHandle) &&
				!isFileShareAccessorHandle(sourceHandle) &&
				!isHTTPAccessorHandle(sourceHandle) &&
				!isHTTPProxyAccessorHandle(sourceHandle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPProxyAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			let ffMpegProcess: FFMpegProcess | undefined
			let ffProbeProcess: CancelablePromise<any> | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Generating preview' }, async () => {
				// On cancel
				ffMpegProcess?.cancel()
				ffProbeProcess?.cancel()
			}).do(async () => {
				const tryReadPackage = await sourceHandle.checkPackageReadAccess()
				if (!tryReadPackage.success) throw new Error(tryReadPackage.reason.tech)

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const actualSourceVersionHash = hashObj(actualSourceVersion)
				// const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

				const metadata: Metadata = {
					sourceVersionHash: actualSourceVersionHash,
					version: {
						...{
							// Default values:
							type: Expectation.Version.Type.MEDIA_FILE_PREVIEW,
							bitrate: '40k',
							width: 320,
							height: -1,
						},
						...exp.endRequirement.version,
					},
				}

				await targetHandle.removePackage('Prepare for preview generation')

				let inputPath: string
				if (isLocalFolderAccessorHandle(sourceHandle)) {
					inputPath = sourceHandle.fullPath
				} else if (isFileShareAccessorHandle(sourceHandle)) {
					await sourceHandle.prepareFileAccess()
					inputPath = sourceHandle.fullPath
				} else if (isHTTPAccessorHandle(sourceHandle)) {
					inputPath = sourceHandle.fullUrl
				} else if (isHTTPProxyAccessorHandle(sourceHandle)) {
					inputPath = sourceHandle.fullUrl
				} else {
					assertNever(sourceHandle)
					throw new Error(`Unsupported Target AccessHandler`)
				}

				// Scan with FFProbe:
				ffProbeProcess = scanWithFFProbe(sourceHandle)
				const ffProbeScan: FFProbeScanResult = await ffProbeProcess
				ffProbeProcess = undefined
				const hasVideoStream =
					ffProbeScan.streams && ffProbeScan.streams.some((stream) => stream.codec_type === 'video')
				if (!hasVideoStream) {
					workInProgress._reportComplete(
						actualSourceVersionHash,
						{
							user: `Preview generation skipped due to file having no video streams`,
							tech: `Completed at ${Date.now()}`,
						},
						undefined
					)
					return
				}

				const args = previewFFMpegArguments(inputPath, true, metadata)

				const fileOperation = await targetHandle.prepareForOperation('Generate preview', lookupSource.handle)

				ffMpegProcess = await spawnFFMpeg(
					args,
					targetHandle,
					// actualSourceVersionHash,
					async () => {
						// Called when ffmpeg has finished
						worker.logger.debug(`FFMpeg finished [PID=${ffMpegProcess?.pid}]: ${args.join(' ')}`)
						ffMpegProcess = undefined
						await targetHandle.finalizePackage(fileOperation)
						await targetHandle.updateMetadata(metadata)

						const duration = timer.get()
						workInProgress._reportComplete(
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
						workInProgress._reportError(err)
					},
					async (progress: number) => {
						workInProgress._reportProgress(actualSourceVersionHash, progress)
					}
					//,worker.logger.debug
				)
				worker.logger.debug(`FFMpeg started [PID=${ffMpegProcess.pid}]: ${args.join(' ')}`)
			})

			return workInProgress
		} else {
			throw new Error(
				`MediaFilePreview.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupPreviewTargets(worker, exp)
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
					tech: `Cannot remove preview file: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
			// reason: { user: ``, tech: `Removed preview file "${exp.endRequirement.content.filePath}" from target` },
		}
	},
}
function isMediaFilePreview(exp: Expectation.Any): exp is Expectation.MediaFilePreview {
	return exp.type === Expectation.Type.MEDIA_FILE_PREVIEW
}

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.MediaFilePreview
}

async function lookupPreviewSources(
	worker: BaseWorker,
	exp: Expectation.MediaFilePreview
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
async function lookupPreviewTargets(
	worker: BaseWorker,
	exp: Expectation.MediaFilePreview
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
