import { Accessor } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../../../worker'
import { findBestPackageContainerWithAccessToPackage } from '../lib/lib'
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
import { isHTTPAccessorHandle, isLocalFolderHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { ChildProcess, spawn } from 'child_process'

export const MediaFilePreview: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const accessSourcePackageContainer = findBestPackageContainerWithAccessToPackage(
			worker,
			exp.startRequirement.sources
		)
		const accessTargetPackageContainer = findBestPackageContainerWithAccessToPackage(
			worker,
			exp.endRequirement.targets
		)

		const accessorTypeCost: { [key: string]: number } = {
			[Accessor.AccessType.LOCAL_FOLDER]: 1,
			[Accessor.AccessType.QUANTEL]: 1,
			[Accessor.AccessType.FILE_SHARE]: 2,
			[Accessor.AccessType.HTTP]: 3,
		}
		const sourceCost = accessSourcePackageContainer
			? accessorTypeCost[accessSourcePackageContainer.accessor.type as string] || 5
			: Number.POSITIVE_INFINITY

		const targetCost = accessTargetPackageContainer
			? accessorTypeCost[accessTargetPackageContainer.accessor.type as string] || 5
			: Number.POSITIVE_INFINITY

		return 30 * (sourceCost + targetCost)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupPreviewTargets(worker, exp)
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
		_wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issueReadPackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issueReadPackage) {
			return { fulfilled: false, reason: `Preview does not exist: ${issueReadPackage}` }
		}
		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)

		const metadata = await lookupTarget.handle.fetchMetadata()

		if (!metadata) {
			return { fulfilled: false, reason: 'No file found' }
		} else if (metadata.sourceVersionHash !== actualSourceVersionHash) {
			return { fulfilled: false, reason: `Preview version doesn't match file` }
		} else {
			return { fulfilled: true, reason: 'Preview already matches file' }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupPreviewSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		if (
			lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP)
		) {
			// We can read the source and write the preview directly.
			if (!isLocalFolderHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
			if (!isLocalFolderHandle(lookupTarget.handle) && !isHTTPAccessorHandle(lookupTarget.handle))
				throw new Error(`Target AccessHandler type is wrong`)

			let ffMpegProcess: ChildProcess | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Generating preview' }, async () => {
				// On cancel
				if (ffMpegProcess) {
					ffMpegProcess.kill() // todo: signal?
				}
			})

			const issueReadPackage = await lookupSource.handle.checkPackageReadAccess()
			if (issueReadPackage) {
				workInProgress._reportError(new Error(issueReadPackage))
			} else {
				const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
				const actualSourceVersionHash = hashObj(actualSourceVersion)
				// const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

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

				await lookupTarget.handle.removePackage()

				const args = [
					'-hide_banner',
					'-y', // Overwrite output files without asking.
					'-threads 1', // Number of threads to use
					`-i "${lookupSource.handle.fullPath}"`, // Input file path
					'-f webm', // format: webm
					'-an', // blocks all audio streams
					'-c:v libvpx', // encoder for video
					`-b:v ${metadata.version.bitrate || '40k'}`,
					'-auto-alt-ref 0',
					`-vf scale=${metadata.version.width || 190}:${metadata.version.height || -1}`, // Scale to resolution
					'-deadline realtime', // Encoder speed/quality and cpu use (best, good, realtime)
				]

				let pipeStdOut = false
				if (isLocalFolderHandle(lookupTarget.handle)) {
					args.push(`"${lookupTarget.handle.fullPath}"`)
				} else if (isHTTPAccessorHandle(lookupTarget.handle)) {
					pipeStdOut = true
					args.push('pipe:1') // pipe output to stdout
				} else {
					throw new Error(`Unsupported Target AccessHandler`)
				}

				// Report back an initial status, because it looks nice:
				workInProgress._reportProgress(actualSourceVersionHash, 0)

				ffMpegProcess = spawn(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', args, {
					shell: true,
				})

				let FFMpegIsDone = false
				let uploadIsDone = false
				/** To be called when done */
				const onDone = () => {
					if (FFMpegIsDone && uploadIsDone) {
						lookupTarget.handle
							.updateMetadata(metadata)
							.then(() => {
								const duration = Date.now() - startTime
								workInProgress._reportComplete(
									actualSourceVersionHash,
									`Preview generation completed in ${Math.round(duration / 100) / 10}s`,
									undefined
								)
							})
							.catch((err) => {
								workInProgress._reportError(err)
							})
					}
				}

				if (pipeStdOut) {
					if (!ffMpegProcess.stdout) {
						throw new Error('No stdout stream available')
					}

					const writeStream = await lookupTarget.handle.putPackageStream(ffMpegProcess.stdout)
					writeStream.on('error', (err) => {
						workInProgress._reportError(err)
					})
					writeStream.once('close', () => {
						uploadIsDone = true
						onDone()
					})
				} else {
					uploadIsDone = true // no upload
				}
				let fileDuration: number | undefined = undefined
				ffMpegProcess.stderr?.on('data', (data) => {
					const str = data.toString()

					const m = str.match(/Duration:\s?(\d+):(\d+):([\d.]+)/)
					if (m) {
						const hh = m[1]
						const mm = m[2]
						const ss = m[3]

						fileDuration = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)
					} else {
						if (fileDuration) {
							const m2 = str.match(/time=\s?(\d+):(\d+):([\d.]+)/)
							if (m2) {
								const hh = m2[1]
								const mm = m2[2]
								const ss = m2[3]

								const progress = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)
								workInProgress._reportProgress(
									actualSourceVersionHash,
									((uploadIsDone ? 1 : 0.9) * progress) / fileDuration
								)
							}
						}
					}
				})
				ffMpegProcess.on('close', (code) => {
					ffMpegProcess = undefined
					if (code === 0) {
						FFMpegIsDone = true
						onDone()
					} else {
						workInProgress._reportError(new Error(`Code ${code}`))
					}
				})
			}

			return workInProgress
		} else {
			throw new Error(
				`MediaFilePreview.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFilePreview(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupPreviewTargets(worker, exp)
		if (!lookupTarget.ready) {
			return { removed: false, reason: `No access to target: ${lookupTarget.reason}` }
		}

		try {
			await lookupTarget.handle.removePackage()
		} catch (err) {
			return { removed: false, reason: `Cannot remove file: ${err.toString()}` }
		}

		return { removed: true, reason: `Removed file "${exp.endRequirement.content.filePath}" from target` }
	},
}
function isMediaFilePreview(exp: Expectation.Any): exp is Expectation.MediaFilePreview {
	return exp.type === Expectation.Type.MEDIA_FILE_PREVIEW
}

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.MediaFilePreview
}

function lookupPreviewSources(
	worker: GenericWorker,
	exp: Expectation.MediaFilePreview
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
	exp: Expectation.MediaFilePreview
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
