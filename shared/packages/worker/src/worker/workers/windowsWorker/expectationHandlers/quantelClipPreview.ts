import { Accessor } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../../../worker'
import { getStandardCost } from '../lib/lib'
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
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isLocalFolderAccessorHandle,
	isQuantelClipAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { getSourceHTTPHandle } from './quantelClipThumbnail'
import { FFMpegProcess, runffMpeg } from './lib/ffmpeg'
import { WindowsWorker } from '../windowsWorker'

export const QuantelClipPreview: ExpectationWindowsHandler = {
	doYouSupportExpectation(
		exp: Expectation.Any,
		genericWorker: GenericWorker,
		windowsWorker: WindowsWorker
	): ReturnTypeDoYouSupportExpectation {
		if (!windowsWorker.hasFFMpeg) return { support: false, reason: 'Cannot access FFMpeg executable' }
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isQuantelClipPreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isQuantelClipPreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const issueReading = await lookupSource.handle.tryPackageRead()
		if (issueReading) return { ready: false, reason: issueReading }

		// This is a bit special, as we use the Quantel HTTP-transformer to get a HLS-stream of the video:
		if (!isQuantelClipAccessorHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
		const httpStreamURL = await lookupSource.handle.getTransformerStreamURL()
		if (!httpStreamURL) return { ready: false, reason: `Preview source not found` }
		const sourceHTTPHandle = getSourceHTTPHandle(worker, lookupSource.handle, httpStreamURL)

		const issueReadingHTTP = await sourceHTTPHandle.tryPackageRead()
		if (issueReadingHTTP) return { ready: false, reason: issueReadingHTTP }

		return {
			ready: true,
			sourceExists: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		_wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isQuantelClipPreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issueReadPackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issueReadPackage) return { fulfilled: false, reason: `Preview does not exist: ${issueReadPackage}` }

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)

		const metadata = await lookupTarget.handle.fetchMetadata()

		if (!metadata) {
			return { fulfilled: false, reason: 'No preview file found' }
		} else if (metadata.sourceVersionHash !== actualSourceVersionHash) {
			return { fulfilled: false, reason: `Preview version doesn't match preview file` }
		} else {
			return { fulfilled: true, reason: 'Preview already matches preview file' }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isQuantelClipPreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle
		if (
			lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP)
		) {
			// We can read the source and write the preview directly.
			if (!isQuantelClipAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			// This is a bit special, as we use the Quantel HTTP-transformer to get a HLS-stream of the video:
			const httpStreamURL = await sourceHandle.getTransformerStreamURL()
			if (!httpStreamURL) throw new Error(`Preview source not found`)
			const sourceHTTPHandle = getSourceHTTPHandle(worker, lookupSource.handle, httpStreamURL)

			let ffMpegProcess: FFMpegProcess | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Generating preview' }, async () => {
				// On cancel
				if (ffMpegProcess) {
					ffMpegProcess.kill()
				}
			}).do(async () => {
				const issueReadPackage = await sourceHandle.checkPackageReadAccess()
				if (issueReadPackage) throw new Error(issueReadPackage)

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const actualSourceVersionHash = hashObj(actualSourceVersion)

				const metadata: Metadata = {
					sourceVersionHash: actualSourceVersionHash,
					version: {
						...{
							// Default values:
							type: Expectation.Version.Type.MEDIA_FILE_PREVIEW,
							bitrate: '40k',
							width: 190,
							height: -1,
						},
						...exp.endRequirement.version,
					},
				}

				await targetHandle.removePackage()

				const args = [
					'-hide_banner',
					'-y', // Overwrite output files without asking.
					'-threads 1', // Number of threads to use
					'-seekable 0',
					`-i "${sourceHTTPHandle.fullUrl}"`, // Input file path
					'-f webm', // format: webm
					'-an', // blocks all audio streams
					'-c:v libvpx', // encoder for video
					`-b:v ${metadata.version.bitrate || '40k'}`,
					'-auto-alt-ref 0',
					`-vf scale=${metadata.version.width || 190}:${metadata.version.height || -1}`, // Scale to resolution
					'-deadline realtime', // Encoder speed/quality and cpu use (best, good, realtime)
				]

				ffMpegProcess = await runffMpeg(
					workInProgress,
					args,
					targetHandle,
					actualSourceVersionHash,
					async () => {
						// Called when ffmpeg has finished
						ffMpegProcess = undefined
						await targetHandle.updateMetadata(metadata)

						const duration = Date.now() - startTime
						workInProgress._reportComplete(
							actualSourceVersionHash,
							`Preview generation completed in ${Math.round(duration / 100) / 10}s`,
							undefined
						)
					}
				)
			})

			return workInProgress
		} else {
			throw new Error(
				`QuantelClipPreview.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isQuantelClipPreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) {
			return { removed: false, reason: `No access to target: ${lookupTarget.reason}` }
		}

		try {
			await lookupTarget.handle.removePackage()
		} catch (err) {
			return { removed: false, reason: `Cannot remove preview file: ${err.toString()}` }
		}

		return { removed: true, reason: `Removed preview file "${exp.endRequirement.content.filePath}" from target` }
	},
}
function isQuantelClipPreview(exp: Expectation.Any): exp is Expectation.QuantelClipPreview {
	return exp.type === Expectation.Type.QUANTEL_CLIP_PREVIEW
}

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.QuantelClipPreview
}

function lookupPreviewSources(
	worker: GenericWorker,
	exp: Expectation.QuantelClipPreview
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
function lookupPreviewTargets(
	worker: GenericWorker,
	exp: Expectation.QuantelClipPreview
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
