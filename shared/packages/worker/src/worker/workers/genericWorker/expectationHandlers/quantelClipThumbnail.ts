import {
	Accessor,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	literal,
	Reason,
	stringifyError,
	startTimer,
	KnownReason,
} from '@sofie-package-manager/api'
import { getStandardCost } from '../lib/lib'
import { BaseWorker } from '../../../worker'
import {
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
	isQuantelClipAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { PackageReadStream, PutPackageHandler } from '../../../accessorHandlers/genericHandle'
import { ExpectationHandlerGenericWorker, GenericWorker } from '../genericWorker'
import { getSourceHTTPHandle, QuantelClipMetadata } from './lib/quantel'

/**
 * Generates a thumbnail image from a source quantel clip, and stores the resulting file into the target PackageContainer
 */
export const QuantelThumbnail: ExpectationHandlerGenericWorker = {
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
		return checkWorkerHasAccessToPackageContainersOnPackage(worker, {
			sources: exp.startRequirement.sources,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready)
			return {
				ready: lookupSource.ready,
				knownReason: lookupSource.knownReason,
				sourceExists: false,
				reason: lookupSource.reason,
			}
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
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

		// This is a bit special, as we use the Quantel HTTP-transformer to extract the thumbnail:
		const thumbnailURL = await getThumbnailURL(exp, lookupSource)
		if (!thumbnailURL.success)
			return {
				ready: false,
				knownReason: thumbnailURL.knownReason,
				reason: thumbnailURL.reason,
			}
		const sourceHTTPHandle = getSourceHTTPHandle(worker, exp.id, lookupSource.handle, thumbnailURL)

		const tryReadingHTTP = await sourceHTTPHandle.tryPackageRead()
		if (!tryReadingHTTP.success)
			return {
				ready: false,
				knownReason: tryReadingHTTP.knownReason,
				sourceExists: tryReadingHTTP.packageExists,
				reason: tryReadingHTTP.reason,
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
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready)
			return {
				fulfilled: false,
				knownReason: lookupSource.knownReason,
				reason: {
					user: `Not able to access source, due to ${lookupSource.reason.user}`,
					tech: `Not able to access source: ${lookupSource.reason.tech}`,
				},
			}
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready)
			return {
				fulfilled: false,
				knownReason: lookupTarget.knownReason,
				reason: {
					user: `Not able to access target, due to: ${lookupTarget.reason.user} `,
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
		const expectedTargetMetadata: Metadata = getMetadata(exp, actualSourceVersion)

		const targetMetadata = await lookupTarget.handle.fetchMetadata()

		if (!targetMetadata) {
			return {
				fulfilled: false,
				knownReason: true,
				reason: { user: `The thumbnail needs to be re-generated`, tech: `No thumbnail metadata file found` },
			}
		} else if (targetMetadata.sourceVersionHash !== expectedTargetMetadata.sourceVersionHash) {
			return {
				fulfilled: false,
				knownReason: true,
				reason: {
					user: `The thumbnail needs to be re-generated`,
					tech: `Thumbnail version doesn't match thumbnail file`,
				},
			}
		} else {
			return { fulfilled: true }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Fetch the Thumbnail from the Quantel HTTP-transformer and put it on the target

		const timer = startTimer()

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle

		if (
			lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY)
		) {
			if (!isQuantelClipAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)

			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPProxyAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			// This is a bit special, as we use the Quantel HTTP-transformer to extract the thumbnail:
			const thumbnailURL = await getThumbnailURL(exp, lookupSource)
			if (!thumbnailURL.success) throw new Error(`Can't start working due to source: ${thumbnailURL.reason.tech}`)
			const sourceHTTPHandle = getSourceHTTPHandle(worker, exp.id, sourceHandle, thumbnailURL)

			let wasCancelled = false
			let sourceStream: PackageReadStream | undefined
			let writeStream: PutPackageHandler | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Fetching thumbnail' }, async () => {
				// On cancel work
				wasCancelled = true
				await new Promise<void>((resolve, reject) => {
					writeStream?.once('close', () => {
						lookupTarget.handle
							.removePackage('Generate thumbnail cancelled')
							.then(() => resolve())
							.catch((err) => reject(err))
					})
					sourceStream?.cancel()
					writeStream?.abort()
				})
			}).do(async () => {
				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const targetMetadata: Metadata = getMetadata(exp, actualSourceVersion)

				await lookupTarget.handle.removePackage('Prepare for thumbnail generation')

				// Stream the thumbnail from the Quantel-HTTP-transformer and into the target:

				const quantelOperation = await targetHandle.prepareForOperation('Generate thumbnail', sourceHandle)
				sourceStream = await sourceHTTPHandle.getPackageReadStream()
				writeStream = await lookupTarget.handle.putPackageStream(sourceStream.readStream)

				sourceStream.readStream.on('error', (err) => {
					workInProgress._reportError(err)
				})
				writeStream.on('error', (err) => {
					workInProgress._reportError(err)
				})
				writeStream.once('close', () => {
					if (wasCancelled) return // ignore
					setImmediate(() => {
						// Copying is done

						;(async () => {
							await lookupTarget.handle.finalizePackage(quantelOperation)
							await lookupTarget.handle.updateMetadata(targetMetadata)

							const duration = timer.get()
							workInProgress._reportComplete(
								targetMetadata.sourceVersionHash,
								{
									user: `Thumbnail generation completed in ${Math.round(duration / 100) / 10}s`,
									tech: `Completed at ${Date.now()}`,
								},
								undefined
							)
						})().catch((err) => {
							workInProgress._reportError(err)
						})
					})
				})
			})

			return workInProgress
		} else {
			throw new Error(
				`QuantelClipThumbnail.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
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

		return { removed: true }
	},
}
function isQuantelClipThumbnail(exp: Expectation.Any): exp is Expectation.QuantelClipThumbnail {
	return exp.type === Expectation.Type.QUANTEL_CLIP_THUMBNAIL
}
function getMetadata(exp: Expectation.QuantelClipThumbnail, actualSourceVersion: Expectation.Version.Any): Metadata {
	const actualSourceVersionHash = hashObj(actualSourceVersion)

	return literal<Metadata>({
		sourceVersionHash: actualSourceVersionHash,
		version: {
			...{
				// Default values:
				type: Expectation.Version.Type.QUANTEL_CLIP_THUMBNAIL,
				width: 256,
				frame: 0,
			},
			...exp.endRequirement.version,
		},
	})
}
async function getThumbnailURL(
	exp: Expectation.QuantelClipThumbnail,
	lookupSource: LookupPackageContainer<any>
): Promise<
	{ success: true; baseURL: string; url: string } | { success: false; knownReason: KnownReason; reason: Reason }
> {
	if (!lookupSource.accessor) throw new Error(`Source accessor not set!`)
	if (lookupSource.accessor.type !== Accessor.AccessType.QUANTEL)
		throw new Error(`Source accessor should have been a Quantel ("${lookupSource.accessor.type}")`)
	if (!isQuantelClipAccessorHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)

	if (!lookupSource.accessor.transformerURL)
		return {
			success: false,
			knownReason: true,
			reason: {
				user: `transformerURL is not set in settings`,
				tech: `transformerURL not set on accessor ${lookupSource.handle.accessorId}`,
			},
		}

	const clip = await lookupSource.handle.getClip()
	if (clip) {
		const width = exp.endRequirement.version.width
		let frame: number = exp.endRequirement.version.frame || 0
		if (frame > 0 && frame < 1) {
			// If between 0 and 1, will be treated as % of the source duration:
			const totalFrames = parseInt(clip.Frames, 10)

			if (totalFrames) {
				frame = Math.floor(totalFrames * frame)
			}
		}

		return {
			success: true,
			baseURL: lookupSource.accessor.transformerURL,
			url: `/quantel/homezone/clips/stills/${clip.ClipID}/${frame}.${width ? width + '.' : ''}jpg`,
		}
	} else {
		return {
			success: false,
			knownReason: true,
			reason: {
				user: `Source clip not found`,
				tech: `Source clip not found`,
			},
		}
	}
}

type Metadata = QuantelClipMetadata

async function lookupThumbnailSources(
	worker: BaseWorker,
	exp: Expectation.QuantelClipThumbnail
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
async function lookupThumbnailTargets(
	worker: BaseWorker,
	exp: Expectation.QuantelClipThumbnail
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
