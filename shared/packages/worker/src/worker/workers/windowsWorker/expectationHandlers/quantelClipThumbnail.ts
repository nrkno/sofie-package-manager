import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import {
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	literal,
} from '@shared/api'
import { getStandardCost } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	getAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isLocalFolderAccessorHandle,
	isQuantelClipAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { GenericAccessorHandle, PackageReadStream, PutPackageHandler } from '../../../accessorHandlers/genericHandle'
import { HTTPAccessorHandle } from '../../../accessorHandlers/http'

/**
 * Generates a thumbnail image from a source quantel clip, and stores the resulting file into the target PackageContainer
 */
export const QuantelThumbnail: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const issueReading = await lookupSource.handle.tryPackageRead()
		if (issueReading) return { ready: false, reason: issueReading }

		// This is a bit special, as we use the Quantel HTTP-transformer to extract the thumbnail:
		const thumbnailURL = await getThumbnailURL(exp, lookupSource)
		if (!thumbnailURL) return { ready: false, reason: `Thumbnail source not found` }
		const sourceHTTPHandle = getSourceHTTPHandle(worker, lookupSource.handle, thumbnailURL)

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
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issueReadPackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issueReadPackage) return { fulfilled: false, reason: `Thumbnail does not exist: ${issueReadPackage}` }

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const expectedTargetMetadata: Metadata = getMetadata(exp, actualSourceVersion)

		const targetMetadata = await lookupTarget.handle.fetchMetadata()

		if (!targetMetadata) {
			return { fulfilled: false, reason: 'No file found' }
		} else if (targetMetadata.sourceVersionHash !== expectedTargetMetadata.sourceVersionHash) {
			return { fulfilled: false, reason: `Thumbnail version hash doesn't match file` }
		} else {
			return { fulfilled: true, reason: 'Thumbnail already matches file' }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Fetch the Thumbnail from the Quantel HTTP-transformer and put it on the target

		const startTime = Date.now()

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle

		if (
			lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP)
		) {
			if (!isQuantelClipAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)

			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			// This is a bit special, as we use the Quantel HTTP-transformer to extract the thumbnail:
			const thumbnailURL = await getThumbnailURL(exp, lookupSource)
			if (!thumbnailURL) throw new Error(`Can't start working due to source: Thumbnail url not found`)
			const sourceHTTPHandle = getSourceHTTPHandle(worker, sourceHandle, thumbnailURL)

			let wasCancelled = false
			let sourceStream: PackageReadStream | undefined
			let writeStream: PutPackageHandler | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Fetching thumbnail' }, async () => {
				// On cancel work
				wasCancelled = true
				await new Promise<void>((resolve, reject) => {
					writeStream?.once('close', () => {
						lookupTarget.handle
							.removePackage()
							.then(() => resolve())
							.catch((err) => reject(err))
					})
					sourceStream?.cancel()
					writeStream?.abort()
				})
			}).do(async () => {
				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const targetMetadata: Metadata = getMetadata(exp, actualSourceVersion)

				await lookupTarget.handle.removePackage()

				// Stream the thumbnail from the Quantel-HTTP-transformer and into the target:

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
						const duration = Date.now() - startTime

						lookupTarget.handle
							.updateMetadata(targetMetadata)
							.then(() => {
								workInProgress._reportComplete(
									targetMetadata.sourceVersionHash,
									`Thumbnail fetched in ${Math.round(duration / 100) / 10}s`,
									undefined
								)
							})
							.catch((err) => {
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
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isQuantelClipThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		await lookupTarget.handle.removePackage()

		return { removed: true, reason: 'Removed thumbnail' }
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
): Promise<{ baseURL: string; url: string } | undefined> {
	if (!lookupSource.accessor) throw new Error(`Source accessor not set!`)
	if (lookupSource.accessor.type !== Accessor.AccessType.QUANTEL)
		throw new Error(`Source accessor should have been a Quantel ("${lookupSource.accessor.type}")`)
	if (!isQuantelClipAccessorHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)

	if (!lookupSource.accessor.transformerURL) return undefined

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
			baseURL: lookupSource.accessor.transformerURL,
			url: `/quantel/homezone/clips/stills/${clip.ClipID}/${frame}.${width ? width + '.' : ''}jpg`,
		}
	}
	return undefined
}
export function getSourceHTTPHandle(
	worker: GenericWorker,
	sourceHandle: GenericAccessorHandle<any>,
	thumbnailURL: { baseURL: string; url: string }
): HTTPAccessorHandle<any> {
	// This is a bit special, as we use the Quantel HTTP-transformer to extract the thumbnail,
	// so we have a QUANTEL source, but we construct an HTTP source from it to use instead:

	const handle = getAccessorHandle<Metadata>(
		worker,
		sourceHandle.accessorId + '__http',
		literal<AccessorOnPackage.HTTP>({
			type: Accessor.AccessType.HTTP,
			baseUrl: thumbnailURL.baseURL,
			// networkId?: string
			url: thumbnailURL.url,
		}),
		{ filePath: thumbnailURL.url },
		{}
	)
	if (!isHTTPAccessorHandle(handle)) throw new Error(`getSourceHTTPHandle: got a non-HTTP handle!`)
	return handle
}

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.QuantelClipThumbnail
}

function lookupThumbnailSources(
	worker: GenericWorker,
	exp: Expectation.QuantelClipThumbnail
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
function lookupThumbnailTargets(
	worker: GenericWorker,
	exp: Expectation.QuantelClipThumbnail
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
