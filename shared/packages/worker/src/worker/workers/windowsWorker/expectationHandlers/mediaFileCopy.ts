import { Accessor } from '@sofie-automation/blueprints-integration'
import { Expectation } from '@shared/api'
import { GenericWorker } from '../../../worker'
import { roboCopyFile } from '../lib/robocopy'
import { diff } from 'deep-diff'
import {
	UniversalVersion,
	compareUniversalVersions,
	makeUniversalVersion,
	findBestPackageContainerWithAccess,
} from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { hashObj } from '@shared/api'
import {
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isLocalFolderHandle,
} from '../../../accessorHandlers/accessor'
import { ByteCounter } from '../../../lib/streamByteCounter'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import {
	checkWorkerHasAccessToPackageContainers,
	lookupAccessorHandles,
	LookupPackageContainer,
	userReadableDiff,
	waitTime,
} from './lib'

// import { LocalFolderAccessorHandle } from '../../../accessorHandlers/localFolder'

export const MediaFileCopy: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): { support: boolean; reason: string } {
		return checkWorkerHasAccessToPackageContainers(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<number> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const accessSourcePackageContainer = findBestPackageContainerWithAccess(worker, exp.startRequirement.sources)
		const accessTargetPackageContainer = findBestPackageContainerWithAccess(worker, exp.endRequirement.targets)

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
	): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, reason: lookupSource.reason }
		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		// Also check that the source is stable (such as that the file size hasn't changed), to not start working on growing files.
		// This is similar to chokidars' awaitWriteFinish.stabilityThreshold feature.
		{
			const actualSourceVersion0 = await lookupSource.handle.getPackageActualVersion()

			const STABILITY_THRESHOLD = 4000 // ms
			await waitTime(STABILITY_THRESHOLD)

			const actualSourceVersion1 = await lookupSource.handle.getPackageActualVersion()

			// Note for posterity:
			// In local tests with a file share this doesn't seem to work that well
			// as the fs.stats doesn't seem to update during file copy in Windows.
			// Maybe there is a better way to detect growing files?

			const versionDiff = diff(actualSourceVersion0, actualSourceVersion1)

			if (versionDiff) {
				return {
					ready: false,
					reason: `Source is not stable (${userReadableDiff(versionDiff)})`,
				}
			}
		}

		// Also check if we actually can read from the package:
		const issueReading = await lookupSource.handle.tryPackageRead()
		if (issueReading) return { ready: false, reason: issueReading }

		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ fulfilled: boolean; reason: string }> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issuePackage) {
			return { fulfilled: false, reason: `File does not exist: ${issuePackage.toString()}` }
		}

		// check that the file is of the right version:
		const actualTargetVersion = await lookupTarget.handle.fetchMetadata()
		if (!actualTargetVersion) return { fulfilled: false, reason: `Metadata missing` }

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		const issueVersions = compareUniversalVersions(makeUniversalVersion(actualSourceVersion), actualTargetVersion)
		if (issueVersions) {
			return { fulfilled: false, reason: issueVersions }
		}

		return {
			fulfilled: true,
			reason: `File "${exp.endRequirement.content.filePath}" already exists on location`,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)
		const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

		if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE) &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE)
		) {
			// We can do RoboCopy
			if (!isLocalFolderHandle(lookupSource.handle) && !isFileShareAccessorHandle(lookupSource.handle))
				throw new Error(`Source AccessHandler type is wrong`)
			if (!isLocalFolderHandle(lookupTarget.handle)) throw new Error(`Source AccessHandler type is wrong`)

			if (lookupSource.handle.fullPath === lookupTarget.handle.fullPath) {
				throw new Error('Unable to copy: source and Target file paths are the same!')
			}

			let wasCancelled = false
			const workInProgress = new WorkInProgress('Copying, using Robocopy', async () => {
				// on cancel
				wasCancelled = true
				copying.cancel()

				// Wait a bit to allow freeing up of resources:
				await waitTime(1000)

				// Remove target files
				await lookupTarget.handle.removePackage()
				await lookupTarget.handle.removeMetadata()
			})

			const sourcePath = lookupSource.handle.fullPath
			const targetPath = lookupTarget.handle.fullPath

			const copying = roboCopyFile(sourcePath, targetPath, (progress: number) => {
				workInProgress._reportProgress(actualSourceVersionHash, progress / 100)
			})

			copying
				.then(async () => {
					if (wasCancelled) return // ignore
					const duration = Date.now() - startTime

					await lookupTarget.handle.updateMetadata(actualSourceUVersion)

					workInProgress._reportComplete(
						actualSourceVersionHash,
						`Copy completed in ${Math.round(duration / 100) / 10}s`,
						undefined
					)
				})
				.catch((err: Error) => {
					workInProgress._reportError(new Error(err.toString() + ` "${sourcePath}", "${targetPath}"`))
				})
			return workInProgress
		} else if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP) &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP)
		) {
			// We can copy by using file streams
			if (
				!isLocalFolderHandle(lookupSource.handle) &&
				!isFileShareAccessorHandle(lookupSource.handle) &&
				!isHTTPAccessorHandle(lookupSource.handle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderHandle(lookupTarget.handle) &&
				!isFileShareAccessorHandle(lookupTarget.handle) &&
				!isHTTPAccessorHandle(lookupTarget.handle)
			)
				throw new Error(`Source AccessHandler type is wrong`)

			let wasCancelled = false
			const workInProgress = new WorkInProgress('Copying, using streams', async () => {
				// on cancel work
				wasCancelled = true
				await new Promise<void>((resolve, reject) => {
					writeStream.once('close', () => {
						lookupTarget.handle
							.removePackage()
							.then(() => lookupTarget.handle.removeMetadata())
							.then(() => resolve())
							.catch((err) => reject(err))
					})
					sourceStream.cancel()
					writeStream.abort()
				})
			})

			const fileSize: number =
				typeof actualSourceUVersion.fileSize.value === 'number'
					? actualSourceUVersion.fileSize.value
					: parseInt(actualSourceUVersion.fileSize.value || '0', 10)

			const byteCounter = new ByteCounter()
			byteCounter.on('progress', (bytes: number) => {
				if (fileSize) {
					workInProgress._reportProgress(actualSourceVersionHash, bytes / fileSize)
				}
			})

			const sourceStream = await lookupSource.handle.getPackageReadStream()
			const writeStream = await lookupTarget.handle.pipePackageStream(sourceStream.readStream.pipe(byteCounter))

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
						.updateMetadata(actualSourceUVersion)
						.then(() => {
							workInProgress._reportComplete(
								actualSourceVersionHash,
								`Copy completed in ${Math.round(duration / 100) / 10}s`,
								undefined
							)
						})
						.catch((err) => {
							workInProgress._reportError(err)
						})
				})
			})

			return workInProgress
		} else {
			throw new Error(
				`MediaFileCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ removed: boolean; reason: string }> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) {
			return { removed: false, reason: `No access to target: ${lookupTarget.reason}` }
		}

		try {
			await lookupTarget.handle.removePackage()
			await lookupTarget.handle.removeMetadata()
		} catch (err) {
			return { removed: false, reason: `Cannot remove file: ${err.toString()}` }
		}

		return { removed: true, reason: `Removed file "${exp.endRequirement.content.filePath}" from location` }
	},
}
function isMediaFileCopy(exp: Expectation.Any): exp is Expectation.MediaFileCopy {
	return exp.type === Expectation.Type.MEDIA_FILE_COPY
}

function lookupCopySources(
	worker: GenericWorker,
	exp: Expectation.MediaFileCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(worker, exp.startRequirement.sources, exp.endRequirement.content, {
		read: true,
		readPackage: true,
		packageVersion: exp.endRequirement.version,
	})
}
function lookupCopyTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFileCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(worker, exp.endRequirement.targets, exp.endRequirement.content, {
		write: true,
		writePackageContainer: true,
	})
}
