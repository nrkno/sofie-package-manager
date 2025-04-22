import { BaseWorker } from '../../../../worker'
import { roboCopyFile } from '../../lib/robocopy'
import { UniversalVersion, compareUniversalVersions, makeUniversalVersion, compareResourceIds } from '../../lib/lib'
import {
	Accessor,
	hashObj,
	waitTime,
	Expectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	startTimer,
} from '@sofie-package-manager/api'
import {
	isATEMAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
	isQuantelClipAccessorHandle,
} from '../../../../accessorHandlers/accessor'
import { ByteCounter } from '../../../../lib/streamByteCounter'
import { WorkInProgress } from '../../../../lib/workInProgress'
import { LookupPackageContainer, userReadableDiff } from '../lib'
import { CancelablePromise } from '../../../../lib/cancelablePromise'
import { PackageReadStream, PutPackageHandler } from '../../../../accessorHandlers/genericHandle'
import { diff } from 'deep-diff'
import { quantelFileFlowCopy } from '../../lib/quantelFileflow'

export async function isFileReadyToStartWorkingOn(
	worker: BaseWorker,
	lookupSource: LookupPackageContainer<UniversalVersion>,
	lookupTarget: LookupPackageContainer<UniversalVersion>
): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
	if (!lookupSource.ready)
		return {
			ready: lookupSource.ready,
			knownReason: lookupSource.knownReason,
			sourceExists: false,
			reason: lookupSource.reason,
		}
	if (!lookupTarget.ready)
		return { ready: lookupTarget.ready, knownReason: lookupTarget.knownReason, reason: lookupTarget.reason }

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

	const sourcePackageStabilityThreshold: number = worker.agentAPI.config.sourcePackageStabilityThreshold ?? 4000 // Defaults to 4000 ms
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
				knownReason: true,
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
}
export async function isFileFulfilled(
	_worker: BaseWorker,
	lookupSource: LookupPackageContainer<UniversalVersion>,
	lookupTarget: LookupPackageContainer<UniversalVersion>
): Promise<ReturnTypeIsExpectationFulfilled> {
	if (!lookupTarget.ready)
		return {
			fulfilled: false,
			knownReason: lookupTarget.knownReason,
			reason: {
				user: `Not able to access target, due to: ${lookupTarget.reason.user} `,
				tech: `Not able to access target: ${lookupTarget.reason.tech}`,
			},
		}

	const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
	if (!issuePackage.success) {
		return {
			fulfilled: false,
			knownReason: issuePackage.knownReason,
			reason: {
				user: `Target package: ${issuePackage.reason.user}`,
				tech: `Target package: ${issuePackage.reason.tech}`,
			},
		}
	}

	// check that the file is of the right version:
	const actualTargetVersion = await lookupTarget.handle.fetchMetadata()
	if (!actualTargetVersion)
		return {
			fulfilled: false,
			knownReason: true,
			reason: { user: `Target version is wrong`, tech: `Metadata missing` },
		}

	if (!lookupSource.ready)
		return { fulfilled: false, knownReason: lookupSource.knownReason, reason: lookupSource.reason }

	const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

	const issueVersions = compareUniversalVersions(makeUniversalVersion(actualSourceVersion), actualTargetVersion)
	if (!issueVersions.success) {
		return { fulfilled: false, knownReason: issueVersions.knownReason, reason: issueVersions.reason }
	}

	return {
		fulfilled: true,
		// reason: `File "${exp.endRequirement.content.filePath}" already exists on target`,
	}
}
export async function doFileCopyExpectation(
	exp: Expectation.FileCopy | Expectation.FileCopyProxy,
	lookupSource: LookupPackageContainer<UniversalVersion>,
	lookupTarget: LookupPackageContainer<UniversalVersion>
): Promise<WorkInProgress | null> {
	if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)
	if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

	const timer = startTimer()

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
			await targetHandle.removePackage('Copy file, using Robocopy, cancelled')
		}).do(async () => {
			const fileOperation = await targetHandle.prepareForOperation(
				'Copy file, using Robocopy',
				lookupSource.handle
			)

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

			await targetHandle.finalizePackage(fileOperation)
			await targetHandle.updateMetadata(actualSourceUVersion)

			const duration = timer.get()
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
						.removePackage('Copy file, using streams, cancelled')
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

			const fileOperation = await targetHandle.prepareForOperation(
				'Copy file, using streams',
				lookupSource.handle
			)

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
						await targetHandle.finalizePackage(fileOperation)
						await targetHandle.updateMetadata(actualSourceUVersion)

						const duration = timer.get()
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
		if (!sourceHandle.fileFlowURL) throw new Error(`Source AccessHandler does not have a Fileflow URL set`)

		targetHandle.disableDriveMapping = true // FileFlow needs to use the network share, not the mapped network drive

		const fileflowURL = sourceHandle.fileFlowURL
		const profile = sourceHandle.fileFlowProfile
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
			throw new Error(`Could not settle on zone information for Source AccessHandler: ${sourceHandle.accessorId}`)
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
			await targetHandle.removePackage('Copy file, using Fileflow, cancelled')
		}).do(async () => {
			const fileOperation = await targetHandle.prepareForOperation(
				'Copy file, using Fileflow',
				lookupSource.handle
			)

			const sourceClip = await sourceHandle.getClip()
			if (!sourceClip) {
				throw new Error(`Could not fetch clip information from ${sourceHandle.accessorId}`)
			}

			const targetPath = exp.workOptions.useTemporaryFilePath
				? targetHandle.temporaryFilePath
				: targetHandle.fullPath

			const sourceClipId = sourceClip.ClipID.toString()
			copying = quantelFileFlowCopy(
				fileflowURL,
				profile,
				sourceClipId,
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

			await targetHandle.finalizePackage(fileOperation)
			await targetHandle.updateMetadata(actualSourceUVersion)

			const duration = timer.get()
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
		return null
	}
}
