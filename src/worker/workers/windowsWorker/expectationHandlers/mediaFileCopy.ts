import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../../expectationApi'
import { GenericWorker } from '../../../worker'
import { roboCopyFile } from '../lib/robocopy'
import {
	UniversalVersion,
	compareActualExpectVersions,
	compareUniversalVersions,
	makeUniversalVersion,
	findPackageContainerWithAccess,
} from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { hashObj } from '../../../lib/lib'
import {
	getAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isLocalFolderHandle,
} from '../../../accessorHandlers/accessor'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import { ByteCounter } from '../../../lib/streamByteCounter'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'

export const MediaFileCopy: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): { support: boolean; reason: string } {
		// Check that we have access to the packageContainers
		const accessSourcePackageContainer = findPackageContainerWithAccess(genericWorker, exp.startRequirement.sources)
		const accessTargetPackageContainer = findPackageContainerWithAccess(genericWorker, exp.endRequirement.targets)
		if (accessSourcePackageContainer) {
			if (accessTargetPackageContainer) {
				return {
					support: true,
					reason: `Has access to source "${accessSourcePackageContainer.packageContainer.label}" through accessor "${accessSourcePackageContainer.accessorId}" and target "${accessTargetPackageContainer.packageContainer.label}" through accessor "${accessTargetPackageContainer.accessorId}"`,
				}
			} else {
				return { support: false, reason: `Doesn't have access to any of the target packageContainers` }
			}
		} else {
			return { support: false, reason: `Doesn't have access to any of the source packageContainers` }
		}
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) {
			return {
				ready: lookupSource.ready,
				reason: lookupSource.reason,
			}
		}
		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) {
			return {
				ready: lookupTarget.ready,
				reason: lookupTarget.reason,
			}
		}

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

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issuePackage) {
			return { fulfilled: false, reason: `File does not exist: ${issuePackage.toString()}` }
		}

		// check that the file is of the right version:
		const actualTargetVersion = await lookupTarget.handle.fetchMetadata()
		if (!actualTargetVersion) return { fulfilled: false, reason: `Metadata missing` }

		const lookupSource = await lookupSources(worker, exp)
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

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupTargets(worker, exp)
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

			const workInProgress = new WorkInProgress(async () => {
				// on cancel
				copying.cancel()
				// todo: should we remove the target file?
				try {
					lookupTarget.handle.removePackage()
				} catch (err) {
					// todo: what to do if it fails at this point?
				}
			})

			const copying = roboCopyFile(
				lookupSource.handle.fullPath,
				lookupTarget.handle.fullPath,
				(progress: number) => {
					workInProgress._reportProgress(actualSourceVersionHash, progress / 100)
				}
			)

			copying
				.then(async () => {
					const duration = Date.now() - startTime

					await lookupTarget.handle.updateMetadata(actualSourceUVersion)

					workInProgress._reportComplete(
						actualSourceVersionHash,
						`Copy completed in ${Math.round(duration / 100) / 10}s`,
						undefined
					)
				})
				.catch((err: Error) => {
					workInProgress._reportError(err)
				})
			return workInProgress
		} else if (
			lookupSource.accessor.type === Accessor.AccessType.HTTP &&
			lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER
		) {
			// We can copy by using file streams
			if (!isHTTPAccessorHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
			if (!isLocalFolderHandle(lookupTarget.handle)) throw new Error(`Source AccessHandler type is wrong`)

			const workInProgress = new WorkInProgress(async () => {
				// on cancel work

				writeStream.once('close', () => {
					console.log('writeStream close!')
					lookupTarget.handle.removePackage()
				})
				sourceStream.cancel()
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
			sourceStream.readStream.on('end', () => {
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

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) {
			return { removed: false, reason: `No access to target: ${lookupTarget.reason}` }
		}

		try {
			await lookupTarget.handle.removePackage()
		} catch (err) {
			return { removed: false, reason: `Cannot remove file: ${err.toString()}` }
		}

		return { removed: true, reason: `Removed file "${exp.endRequirement.content.filePath}" from location` }
	},
}
function isMediaFileCopy(exp: Expectation.Any): exp is Expectation.MediaFileCopy {
	return exp.type === Expectation.Type.MEDIA_FILE_COPY
}

type LookupPackageContainer =
	| {
			accessor: AccessorOnPackage.Any
			handle: GenericAccessorHandle<UniversalVersion>
			ready: true
			reason: string
	  }
	| {
			accessor: undefined
			handle: undefined
			ready: false
			reason: string
	  }

/** Check that we have any access to a Package on an source-packageContainer, then return the packageContainer */
async function lookupSources(worker: GenericWorker, exp: Expectation.MediaFileCopy): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No source found'

	// See if the file is available at any of the sources:
	for (const packageContainer of exp.startRequirement.sources) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle<UniversalVersion>(worker, accessor, exp.endRequirement.content)

			const issueHandle = handle.checkHandleRead()
			if (issueHandle) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueHandle}`
				continue // Maybe next source works?
			}

			const issueSourcePackage = await handle.checkPackageReadAccess()
			if (issueSourcePackage) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueSourcePackage}`
				continue // Maybe next source works?
			}

			const actualSourceVersion = await handle.getPackageActualVersion()

			const issuePackageVersion = compareActualExpectVersions(actualSourceVersion, exp.endRequirement.version)
			if (issuePackageVersion) {
				errorReason = `${packageContainer.label}: ${issuePackageVersion}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
					// foundPath: fullPath,
					accessor: accessor,
					handle: handle,
					ready: true,
					reason: `Can access source "${packageContainer.label}" through accessor "${accessorId}"`,
				}
			}
		}
	}
	return {
		// foundPath: undefined,
		accessor: undefined,
		handle: undefined,
		ready: false,
		reason: errorReason,
	}
}

/** Check that we have any access to a Package on an target-packageContainer, then return the packageContainer */
async function lookupTargets(worker: GenericWorker, exp: Expectation.MediaFileCopy): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const packageContainer of exp.endRequirement.targets) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle<UniversalVersion>(worker, accessor, exp.endRequirement.content)

			const issueHandle = handle.checkHandleWrite()
			if (issueHandle) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueHandle}`
				continue // Maybe next source works?
			}

			const issuePackage = await handle.checkPackageContainerWriteAccess()
			if (issuePackage) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issuePackage}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
					// foundPath: fullPath,
					accessor: accessor,
					handle: handle,
					ready: true,
					reason: `Can access target "${packageContainer.label}" through accessor "${accessorId}"`,
				}
			}
		}
	}
	return {
		accessor: undefined,
		handle: undefined,
		ready: false,
		reason: errorReason,
	}
}
