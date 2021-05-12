import { Accessor } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../../../worker'
import { roboCopyFile } from '../lib/robocopy'
// import { diff } from 'deep-diff'
import { UniversalVersion, compareUniversalVersions, makeUniversalVersion, getStandardCost } from '../lib/lib'
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
} from '../../../accessorHandlers/accessor'
import { ByteCounter } from '../../../lib/streamByteCounter'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import {
	checkWorkerHasAccessToPackageContainersOnPackage,
	lookupAccessorHandles,
	LookupPackageContainer,
	waitTime,
} from './lib'
import { CancelablePromise } from '../../../lib/cancelablePromise'
import { PackageReadStream, PutPackageHandler } from '../../../accessorHandlers/genericHandle'

/**
 * Copies a file from one of the sources and into the target PackageContainer
 */
export const FileCopy: ExpectationWindowsHandler = {
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
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		// Note: This part is disabled for the moment, as the results are unreliable and slows down the checking significantly.
		//
		// let sourceIsOld: boolean = false
		// // Do a quick-check
		// if (isLocalFolderHandle(lookupSource.handle)) {
		// 	const version = await lookupSource.handle.getPackageActualVersion()
		// 	if (version.modifiedDate < Date.now() - 1000 * 3600 * 1) {
		// 		// The file seems to be fairly old, it should be safe to assume that
		// 		sourceIsOld = true
		// 	}
		// }

		// const sourcePackageStabilityThreshold: number = worker.genericConfig.sourcePackageStabilityThreshold ?? 4000 // Defaults to 4000 ms
		// if (sourcePackageStabilityThreshold !== 0 && !sourceIsOld) {
		// 	// Also check that the source is stable (such as that the file size hasn't changed), to not start working on growing files.
		// 	// This is similar to chokidars' awaitWriteFinish.stabilityThreshold feature.

		// 	const actualSourceVersion0 = await lookupSource.handle.getPackageActualVersion()

		// 	await waitTime(sourcePackageStabilityThreshold)

		// 	const actualSourceVersion1 = await lookupSource.handle.getPackageActualVersion()

		// 	// Note for posterity:
		// 	// In local tests with a file share this doesn't seem to work that well
		// 	// as the fs.stats doesn't seem to update during file copy in Windows.

		// 	const versionDiff = diff(actualSourceVersion0, actualSourceVersion1)

		// 	if (versionDiff) {
		// 		return {
		// 			ready: false,
		// 			sourceExists: true,
		// 			reason: `Source is not stable (${userReadableDiff(versionDiff)})`,
		// 		}
		// 	}
		// }

		// Also check if we actually can read from the package,
		// This might help in some cases if the file is currently transferring
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
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

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
			reason: `File "${exp.endRequirement.content.filePath}" already exists on target`,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)
		const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle
		if (
			process.platform === 'win32' && // Robocopy is a windows-only feature
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE) &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE)
		) {
			// We can do RoboCopy
			if (!isLocalFolderAccessorHandle(sourceHandle) && !isFileShareAccessorHandle(sourceHandle))
				throw new Error(`Source AccessHandler type is wrong`)
			if (!isLocalFolderAccessorHandle(targetHandle)) throw new Error(`Source AccessHandler type is wrong`)

			if (sourceHandle.fullPath === targetHandle.fullPath) {
				throw new Error('Unable to copy: source and Target file paths are the same!')
			}

			let wasCancelled = false
			let copying: CancelablePromise<void> | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Copying, using Robocopy' }, async () => {
				// on cancel
				wasCancelled = true
				copying?.cancel()

				// Wait a bit to allow freeing up of resources:
				await waitTime(1000)

				// Remove target files
				await targetHandle.removePackage()
			}).do(async () => {
				await targetHandle.packageIsInPlace()

				const sourcePath = sourceHandle.fullPath
				const targetPath = targetHandle.fullPath

				copying = roboCopyFile(sourcePath, targetPath, (progress: number) => {
					workInProgress._reportProgress(actualSourceVersionHash, progress / 100)
				})

				await copying
				// The copy is done
				copying = undefined
				if (wasCancelled) return // ignore

				const duration = Date.now() - startTime

				await targetHandle.updateMetadata(actualSourceUVersion)

				workInProgress._reportComplete(
					actualSourceVersionHash,
					`Copy completed in ${Math.round(duration / 100) / 10}s`,
					undefined
				)
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
				!isLocalFolderAccessorHandle(lookupSource.handle) &&
				!isFileShareAccessorHandle(lookupSource.handle) &&
				!isHTTPAccessorHandle(lookupSource.handle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPAccessorHandle(targetHandle)
			)
				throw new Error(`Source AccessHandler type is wrong`)

			let wasCancelled = false
			let sourceStream: PackageReadStream | undefined = undefined
			let writeStream: PutPackageHandler | undefined = undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Copying, using streams' }, async () => {
				// on cancel work
				wasCancelled = true
				await new Promise<void>((resolve, reject) => {
					writeStream?.once('close', () => {
						targetHandle
							.removePackage()
							.then(() => resolve())
							.catch((err) => reject(err))
					})
					sourceStream?.cancel()
					writeStream?.abort()
				})
			}).do(async () => {
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

				if (wasCancelled) return
				sourceStream = await lookupSource.handle.getPackageReadStream()
				writeStream = await targetHandle.putPackageStream(sourceStream.readStream.pipe(byteCounter))

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

						targetHandle
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
			})

			return workInProgress
		} else {
			throw new Error(
				`FileCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupCopyTargets(worker, exp)
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
function isFileCopy(exp: Expectation.Any): exp is Expectation.FileCopy {
	return exp.type === Expectation.Type.FILE_COPY
}

function lookupCopySources(
	worker: GenericWorker,
	exp: Expectation.FileCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.startRequirement.sources,
		exp.endRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.endRequirement.version,
		}
	)
}
function lookupCopyTargets(
	worker: GenericWorker,
	exp: Expectation.FileCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
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
