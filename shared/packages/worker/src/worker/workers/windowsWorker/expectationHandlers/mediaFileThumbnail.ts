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
import { getStandardCost } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import {
	checkWorkerHasAccessToPackageContainersOnPackage,
	formatTimeCode,
	lookupAccessorHandles,
	LookupPackageContainer,
	thumbnailFFMpegArguments,
} from './lib'
import { FFMpegProcess, spawnFFMpeg } from './lib/ffmpeg'
import { WindowsWorker } from '../windowsWorker'
import { CancelablePromise } from '../../../lib/cancelablePromise'
import { scanWithFFProbe, FFProbeScanResult } from './lib/scan'

/**
 * Generates a thumbnail image from a source video file, and stores the resulting file into the target PackageContainer
 */
export const MediaFileThumbnail: ExpectationWindowsHandler = {
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
		if (windowsWorker.testFFProbe)
			return {
				support: false,
				reason: {
					user: 'There is an issue with the Worker (FFProbe)',
					tech: `Cannot access FFProbe executable: ${windowsWorker.testFFProbe}`,
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
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success)
			return { ready: false, sourceExists: tryReading.packageExists, reason: tryReading.reason }

		return {
			ready: true,
		}
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		_wasFulfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access source, due to ${lookupSource.reason.user}`,
					tech: `Not able to access source: ${lookupSource.reason.tech}`,
				},
			}
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access target, due to ${lookupTarget.reason.user}`,
					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
				},
			}

		const issueReadPackage = await lookupTarget.handle.checkPackageReadAccess()
		if (!issueReadPackage.success)
			return {
				fulfilled: false,
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
				reason: { user: `The thumbnail needs to be re-generated`, tech: `No thumbnail metadata file found` },
			}
		} else if (metadata.sourceVersionHash !== actualSourceVersionHash) {
			return {
				fulfilled: false,
				reason: {
					user: `The thumbnail needs to be re-generated`,
					tech: `Thumbnail version doesn't match thumbnail file`,
				},
			}
		} else {
			return { fulfilled: true }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Create a thumbnail from the source media file

		const timer = startTimer()

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		let ffMpegProcess: FFMpegProcess | undefined
		let ffProbeProcess: CancelablePromise<any> | undefined
		const workInProgress = new WorkInProgress({ workLabel: 'Generating thumbnail' }, async () => {
			// On cancel
			ffMpegProcess?.cancel()
			ffProbeProcess?.cancel()
		}).do(async () => {
			if (
				(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
					lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
					lookupTarget.accessor.type === Accessor.AccessType.HTTP ||
					lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY) &&
				(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
					lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
					lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY)
			) {
				const sourceHandle = lookupSource.handle
				const targetHandle = lookupTarget.handle
				if (
					!isLocalFolderAccessorHandle(sourceHandle) &&
					!isHTTPAccessorHandle(sourceHandle) &&
					!isFileShareAccessorHandle(sourceHandle) &&
					!isHTTPProxyAccessorHandle(sourceHandle)
				)
					throw new Error(`Source AccessHandler type is wrong`)
				if (
					!isLocalFolderAccessorHandle(targetHandle) &&
					!isFileShareAccessorHandle(targetHandle) &&
					!isHTTPProxyAccessorHandle(targetHandle)
				)
					throw new Error(`Target AccessHandler type is wrong`)

				const tryReadPackage = await sourceHandle.checkPackageReadAccess()
				if (!tryReadPackage.success) {
					throw new Error(tryReadPackage.reason.tech)
				}

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const sourceVersionHash = hashObj(actualSourceVersion)

				const metadata: Metadata = {
					sourceVersionHash: sourceVersionHash,
					version: {
						...{
							// Default values:
							type: Expectation.Version.Type.MEDIA_FILE_THUMBNAIL,
							width: 256,
							height: -1,
							seekTime: 0,
						},
						...exp.endRequirement.version,
					},
				}

				await targetHandle.removePackage('Prepare for thumbnail generation')

				const seekTime = exp.endRequirement.version.seekTime

				const seekTimeCode: string | undefined = seekTime !== undefined ? formatTimeCode(seekTime) : undefined

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

				// Use FFMpeg to generate the thumbnail:
				const args = thumbnailFFMpegArguments(inputPath, metadata, seekTimeCode, hasVideoStream)

				const fileOperation = await targetHandle.prepareForOperation('Generate thumbnail', lookupSource.handle)

				ffMpegProcess = await spawnFFMpeg(
					args,
					targetHandle,
					async () => {
						// Called when ffmpeg has finished
						worker.logger.debug(`FFMpeg finished [PID=${ffMpegProcess?.pid}]: ${args.join(' ')}`)
						ffMpegProcess = undefined

						await targetHandle.finalizePackage(fileOperation)
						await targetHandle.updateMetadata(metadata)

						const duration = timer.get()
						workInProgress._reportComplete(
							sourceVersionHash,
							{
								user: `Thumbnail generation completed in ${Math.round(duration / 100) / 10}s`,
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
						workInProgress._reportProgress(sourceVersionHash, progress)
					}
					// ,worker.logger.debug
				)
				worker.logger.debug(`FFMpeg started [PID=${ffMpegProcess.pid}]: ${args.join(' ')}`)
			} else {
				throw new Error(
					`MediaFileThumbnail.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
				)
			}
		})

		return workInProgress
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) {
			return {
				removed: false,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		}

		try {
			await lookupTarget.handle.removePackage('expectation removed')
		} catch (err) {
			return {
				removed: false,
				reason: {
					user: `Cannot remove file due to an internal error`,
					tech: `Cannot remove preview file: ${stringifyError(err)}`,
				},
			}
		}

		return { removed: true }
	},
}
function isMediaFileThumbnail(exp: Expectation.Any): exp is Expectation.MediaFileThumbnail {
	return exp.type === Expectation.Type.MEDIA_FILE_THUMBNAIL
}

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.MediaFileThumbnail
}

async function lookupThumbnailSources(
	worker: GenericWorker,
	exp: Expectation.MediaFileThumbnail
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
async function lookupThumbnailTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFileThumbnail
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
