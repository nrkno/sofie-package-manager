import { GenericWorker } from '../../../worker'
import { roboCopyFile } from '../lib/robocopy'
// import { diff } from 'deep-diff'
import {
	UniversalVersion,
	compareUniversalVersions,
	makeUniversalVersion,
	getStandardCost,
	compareResourceIds,
} from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	Accessor,
	AccessorOnPackage,
	PackageContainerOnPackage,
	hashObj,
	waitTime,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	Reason,
	stringifyError,
} from '@shared/api'
import {
	isATEMAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
	isQuantelClipAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { ByteCounter } from '../../../lib/streamByteCounter'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import {
	checkWorkerHasAccessToPackageContainersOnPackage,
	lookupAccessorHandles,
	LookupPackageContainer,
	userReadableDiff,
} from './lib'
import { CancelablePromise } from '../../../lib/cancelablePromise'
import { PackageReadStream, PutPackageHandler } from '../../../accessorHandlers/genericHandle'
import { diff } from 'deep-diff'
import { quantelFileflowCopy } from '../lib/quantelFileflow'

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

		let sourceIsOld = false
		// Do a quick check first:
		if (isLocalFolderAccessorHandle(lookupSource.handle) || isFileShareAccessorHandle(lookupSource.handle)) {
			const version = await lookupSource.handle.getPackageActualVersion()
			if (
				version.modifiedDate <
				Date.now() - 1000 * 3600 * 6 // 6 hours
			) {
				// The file seems to be fairly old, it should be safe to assume that it is no longer transferring
				sourceIsOld = true
			}
		}

		const sourcePackageStabilityThreshold: number = worker.genericConfig.sourcePackageStabilityThreshold ?? 4000 // Defaults to 4000 ms
		if (sourcePackageStabilityThreshold !== 0 && !sourceIsOld) {
			// Check that the source is stable (such as that the file size hasn't changed), to not start working on growing files.
			// This is similar to chokidars' awaitWriteFinish.stabilityThreshold feature.

			const actualSourceVersion0 = await lookupSource.handle.getPackageActualVersion()

			await waitTime(sourcePackageStabilityThreshold)

			const actualSourceVersion1 = await lookupSource.handle.getPackageActualVersion()

			// Note for posterity:
			// In local tests with a file share this doesn't seem to work that well
			// as the fs.stats doesn't seem to update during file copy in Windows.

			const versionDiff = diff(actualSourceVersion0, actualSourceVersion1)

			if (versionDiff) {
				return {
					ready: false,
					sourceExists: true,
					reason: {
						user: `Waiting for source file to stop growing`,
						tech: `Source is not stable (${userReadableDiff(versionDiff)})`,
					},
				}
			}
		}

		// Also check if we actually can read from the package,
		// this might help in some cases if the file is currently transferring
		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success) return { ready: false, reason: tryReading.reason }

		return {
			ready: true,
			sourceExists: true,
			// reason: {
			// 	user: 'Ready to start copying',
			// 	tech: `${lookupSource.reason.user}, ${lookupTarget.reason.tech}`,
			// },
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
			return {
				fulfilled: false,
				reason: {
					user: `Not able to access target, due to: ${lookupTarget.reason.user} `,
					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
				},
			}

		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
		if (!issuePackage.success) {
			return {
				fulfilled: false,
				reason: {
					user: `Target package: ${issuePackage.reason.user}`,
					tech: `Target package: ${issuePackage.reason.tech}`,
				},
			}
		}

		// check that the file is of the right version:
		const actualTargetVersion = await lookupTarget.handle.fetchMetadata()
		if (!actualTargetVersion)
			return { fulfilled: false, reason: { user: `Target version is wrong`, tech: `Metadata missing` } }

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) return { fulfilled: false, reason: lookupSource.reason }

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		const issueVersions = compareUniversalVersions(makeUniversalVersion(actualSourceVersion), actualTargetVersion)
		if (!issueVersions.success) {
			return { fulfilled: false, reason: issueVersions.reason }
		}

		return {
			fulfilled: true,
			// reason: `File "${exp.endRequirement.content.filePath}" already exists on target`,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

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
			if (!isLocalFolderAccessorHandle(targetHandle) && !isFileShareAccessorHandle(targetHandle))
				throw new Error(`Target AccessHandler type is wrong`)

			if (sourceHandle.fullPath === targetHandle.fullPath) {
				throw new Error('Unable to copy: Source and Target file paths are the same!')
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
				const targetPath = exp.workOptions.useTemporaryFilePath
					? targetHandle.temporaryFilePath
					: targetHandle.fullPath

				copying = roboCopyFile(sourcePath, targetPath, (progress: number) => {
					workInProgress._reportProgress(actualSourceVersionHash, progress / 100)
				})

				await copying
				// The copy is done at this point

				copying = undefined
				if (wasCancelled) return // ignore

				await targetHandle.finalizePackage()
				await targetHandle.updateMetadata(actualSourceUVersion)

				const duration = Date.now() - startTime
				workInProgress._reportComplete(
					actualSourceVersionHash,
					{
						user: `Copy completed in ${Math.round(duration / 100) / 10}s`,
						tech: `Copy completed at ${Date.now()}`,
					},
					undefined
				)
			})

			return workInProgress
		} else if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP_PROXY) &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY ||
				lookupTarget.accessor.type === Accessor.AccessType.ATEM_MEDIA_STORE)
		) {
			// We can copy by using file streams
			if (
				!isLocalFolderAccessorHandle(lookupSource.handle) &&
				!isFileShareAccessorHandle(lookupSource.handle) &&
				!isHTTPAccessorHandle(lookupSource.handle) &&
				!isHTTPProxyAccessorHandle(lookupSource.handle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPProxyAccessorHandle(targetHandle) &&
				!isATEMAccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

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
					if (writeStream?.usingCustomProgressEvent) return // ignore this callback, we'll be listening to writeStream.on('progress') instead.

					if (fileSize) {
						workInProgress._reportProgress(actualSourceVersionHash, bytes / fileSize)
					}
				})

				if (wasCancelled) return
				sourceStream = await lookupSource.handle.getPackageReadStream()
				writeStream = await targetHandle.putPackageStream(sourceStream.readStream.pipe(byteCounter))

				if (writeStream.usingCustomProgressEvent) {
					writeStream.on('progress', (progress) => {
						workInProgress._reportProgress(actualSourceVersionHash, progress)
					})
				}
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
							await targetHandle.finalizePackage()
							await targetHandle.updateMetadata(actualSourceUVersion)

							const duration = Date.now() - startTime
							workInProgress._reportComplete(
								actualSourceVersionHash,
								{
									user: `Copy completed in ${Math.round(duration / 100) / 10}s`,
									tech: `Copy completed at ${Date.now()}`,
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
		} else if (
			// Because the copying is performed by FileFlow, we only support
			// file-share targets in the same network as Quantel:
			lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
			lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE &&
			compareResourceIds(lookupSource.accessor.networkId, lookupTarget.accessor.networkId)
		) {
			if (!isQuantelClipAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)
			if (!isFileShareAccessorHandle(targetHandle)) throw new Error(`Target AccessHandler type is wrong`)
			if (!sourceHandle.fileflowURL) throw new Error(`Source AccessHandler does not have a Fileflow URL set`)

			targetHandle.disableDriveMapping = true // FileFlow needs to use the network share, not the mapped network drive

			const fileflowURL = sourceHandle.fileflowURL
			const profile = sourceHandle.fileflowProfile
			// If the sourceHandler zoneId is set to a useful value, use that
			let prospectiveZoneId =
				sourceHandle.zoneId !== '' && sourceHandle.zoneId !== 'default' ? sourceHandle.zoneId : undefined
			// If it's not set, ask the ISA for known zones and select the first local one
			if (prospectiveZoneId === undefined) {
				const homeZone = (await sourceHandle.getZoneInfo()).find((zone) => zone.isRemote === false)
				prospectiveZoneId = homeZone?.zoneNumber.toString()
			}
			// If we still couldn't figure out the zoneID, we should abort the operations
			if (prospectiveZoneId === undefined) {
				throw new Error(
					`Could not settle on zone information for Source AccessHandler: ${sourceHandle.accessorId}`
				)
			}

			const zoneId = prospectiveZoneId

			let wasCancelled = false
			let copying: CancelablePromise<void> | undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Copying, using Quantel Fileflow' }, async () => {
				// on cancel
				wasCancelled = true
				copying?.cancel()

				// Wait a bit to allow freeing up of resources:
				await waitTime(1000)

				// Remove target files
				await targetHandle.removePackage()
			}).do(async () => {
				await targetHandle.packageIsInPlace()

				const sourceClip = await sourceHandle.getClip()
				if (!sourceClip) {
					throw new Error(`Could not fetch clip information from ${sourceHandle.accessorId}`)
				}

				const targetPath = exp.workOptions.useTemporaryFilePath
					? targetHandle.temporaryFilePath
					: targetHandle.fullPath

				copying = quantelFileflowCopy(
					fileflowURL,
					profile,
					sourceClip.ClipID.toString(),
					zoneId,
					targetPath,
					(progress: number) => {
						workInProgress._reportProgress(actualSourceVersionHash, progress / 100)
					}
				)

				await copying
				// The copy is done at this point

				copying = undefined
				if (wasCancelled) return // ignore

				await targetHandle.finalizePackage()
				await targetHandle.updateMetadata(actualSourceUVersion)

				const duration = Date.now() - startTime
				workInProgress._reportComplete(
					actualSourceVersionHash,
					{
						user: `Copy completed in ${Math.round(duration / 100) / 10}s`,
						tech: `Copy completed at ${Date.now()}`,
					},
					undefined
				)
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
			return {
				removed: false,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		}

		try {
			await lookupTarget.handle.removePackage()
		} catch (err) {
			return {
				removed: false,
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
			customCheck: checkAccessorForQuantelFileflow,
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

function checkAccessorForQuantelFileflow(
	_packageContainer: PackageContainerOnPackage,
	accessorId: string,
	accessor: AccessorOnPackage.Any
): { success: true } | { success: false; reason: Reason } {
	if (accessor.type === Accessor.AccessType.QUANTEL) {
		if (!accessor.fileflowURL) {
			return {
				success: false,
				reason: {
					user: `Accessor "${accessorId}" does not have a FileFlow URL set.`,
					tech: `Accessor "${accessorId}" does not have a FileFlow URL set.`,
				},
			}
		}
	}
	return {
		success: true,
	}
}
