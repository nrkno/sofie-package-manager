import { ChildProcess, spawn } from 'child_process'
import { Accessor } from '@sofie-automation/blueprints-integration'
import { hashObj } from '@shared/api'
import { Expectation } from '@shared/api'
import { findBestPackageContainerWithAccess } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { isHTTPAccessorHandle, isLocalFolderHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainers, lookupAccessorHandles, LookupPackageContainer } from './lib'

export const MediaFileThumbnail: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): { support: boolean; reason: string } {
		return checkWorkerHasAccessToPackageContainers(genericWorker, {
			sources: exp.startRequirement.sources,
		})
	},
	getCostForExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<number> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const accessSourcePackageContainer = findBestPackageContainerWithAccess(worker, exp.startRequirement.sources)

		const accessorTypeCost: { [key: string]: number } = {
			[Accessor.AccessType.LOCAL_FOLDER]: 1,
			[Accessor.AccessType.QUANTEL]: 1,
			[Accessor.AccessType.FILE_SHARE]: 2,
			[Accessor.AccessType.HTTP]: 3,
		}
		const sourceCost = accessSourcePackageContainer
			? 10 * accessorTypeCost[accessSourcePackageContainer.accessor.type as string] || 5
			: Number.POSITIVE_INFINITY

		return sourceCost
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, reason: lookupSource.reason }
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const issueReading = await lookupSource.handle.tryPackageRead()
		if (issueReading) return { ready: false, reason: issueReading }

		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		_wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<{ fulfilled: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issueReadPackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issueReadPackage) {
			return { fulfilled: false, reason: `Thumbnail does not exist: ${issueReadPackage}` }
		}
		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)

		const metadata = await lookupTarget.handle.fetchMetadata()

		if (!metadata) {
			return { fulfilled: false, reason: 'No file found' }
		} else if (metadata.sourceVersionHash !== actualSourceVersionHash) {
			return { fulfilled: false, reason: `Thumbnail version doesn't match file` }
		} else {
			return { fulfilled: true, reason: 'Thumbnail already matches file' }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Create a thumbnail from the source media file

		const startTime = Date.now()

		const lookupSource = await lookupThumbnailSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		let ffMpegProcess: ChildProcess | undefined
		const workInProgress = new WorkInProgress('Generating thumbnail', async () => {
			// On cancel
			if (ffMpegProcess) {
				ffMpegProcess.kill() // todo: signal?
			}
		}).do(async () => {
			if (
				lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
				(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
					lookupTarget.accessor.type === Accessor.AccessType.HTTP)
			) {
				if (!isLocalFolderHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
				if (!isLocalFolderHandle(lookupTarget.handle) && !isHTTPAccessorHandle(lookupTarget.handle))
					throw new Error(`Target AccessHandler type is wrong`)

				const issueReadPackage = await lookupSource.handle.checkPackageReadAccess()
				if (issueReadPackage) {
					workInProgress._reportError(new Error(issueReadPackage))
				} else {
					const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
					const sourceVersionHash = hashObj(actualSourceVersion)

					const metadata: Metadata = {
						sourceVersionHash: sourceVersionHash,
						version: {
							...{
								// Default values:
								type: Expectation.Version.Type.MEDIA_FILE_THUMBNAIL,
								width: 256,
								height: -1,
							},
							...exp.endRequirement.version,
						},
					}

					await lookupTarget.handle.removeMetadata()
					await lookupTarget.handle.removePackage()

					// Use FFMpeg to generate the thumbnail:
					const args = [
						// process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
						'-hide_banner',
						`-i "${lookupSource.handle.fullPath}"`,
						`-f image2`,
						'-frames:v 1',
						`-vf thumbnail,scale=${metadata.version.width}:` + `${metadata.version.height}`,
						'-threads 1',
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
					workInProgress._reportProgress(sourceVersionHash, 0)

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
										sourceVersionHash,
										`Thumbnail generation completed in ${Math.round(duration / 100) / 10}s`,
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

						const writeStream = await lookupTarget.handle.pipePackageStream(ffMpegProcess.stdout)
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
					let stdErr = ''
					ffMpegProcess.stderr?.on('data', (data) => {
						stdErr += data.toString()
					})

					ffMpegProcess.on('close', (code) => {
						ffMpegProcess = undefined
						if (code === 0) {
							FFMpegIsDone = true
							onDone()
						} else {
							workInProgress._reportError(new Error(`Code ${code} ${stdErr}`))
						}
					})

					// ffMpegProcess = exec(args.join(' '), (err, _stdout, _stderr) => {
					// 	ffMpegProcess = undefined
					// 	if (err) {
					// 		workInProgress._reportError(err)
					// 		return
					// 	}

					// 	lookupTarget.handle
					// 		.updateMetadata(metadata)
					// 		.then(() => {
					// 			const duration = Date.now() - startTime
					// 			workInProgress._reportComplete(
					// 				sourceVersionHash,
					// 				`Thumbnail generation completed in ${Math.round(duration / 100) / 10}s`,
					// 				undefined
					// 			)
					// 		})
					// 		.catch((err) => {
					// 			workInProgress._reportError(err)
					// 		})
					// })
				}
			} else {
				throw new Error(
					`MediaFileThumbnail.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
				)
			}
		})

		return workInProgress
	},
	removeExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ removed: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupThumbnailTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		await lookupTarget.handle.removeMetadata()
		await lookupTarget.handle.removePackage()

		return { removed: true, reason: 'Removed thumbnail' }
	},
}
function isMediaFileThumbnail(exp: Expectation.Any): exp is Expectation.MediaFileThumbnail {
	return exp.type === Expectation.Type.MEDIA_FILE_THUMBNAIL
}

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.MediaFileThumbnail
}

function lookupThumbnailSources(
	worker: GenericWorker,
	exp: Expectation.MediaFileThumbnail
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(worker, exp.startRequirement.sources, exp.startRequirement.content, {
		read: true,
		readPackage: true,
		packageVersion: exp.startRequirement.version,
	})
}
function lookupThumbnailTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFileThumbnail
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(worker, exp.endRequirement.targets, exp.endRequirement.content, {
		write: true,
		writePackageContainer: true,
	})
}
