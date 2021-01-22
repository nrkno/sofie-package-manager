import { exec, ChildProcess } from 'child_process'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { hashObj } from '../../../lib/lib'
import { Expectation } from '../../../expectationApi'
import { compareActualExpectVersions, findPackageContainerWithAccess } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import { getAccessorHandle, isLocalFolderHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'

export const MediaFileThumbnail: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): { support: boolean; reason: string } {
		// Check that we have access to the packageContainer

		const accessSource = findPackageContainerWithAccess(genericWorker, exp.startRequirement.sources)
		if (accessSource) {
			return { support: true, reason: `Has access to source` }
		} else {
			return { support: false, reason: `Doesn't have access to any of the sources` }
		}
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ ready: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) return lookupSource
		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) return lookupTarget
		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ fulfilled: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupTargets(worker, exp)
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

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		let ffMpegProcess: ChildProcess | undefined
		const workInProgress = new WorkInProgress(async () => {
			// On cancel
			if (ffMpegProcess) {
				ffMpegProcess.kill() // todo: signal?
			}
		})

		if (
			lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
			lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER
		) {
			if (!isLocalFolderHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
			if (!isLocalFolderHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

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
					process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
					'-hide_banner',
					`-i "${lookupSource.handle.fullPath}"`,
					'-frames:v 1',
					`-vf thumbnail,scale=${metadata.version.width}:` + `${metadata.version.height}`,
					'-threads 1',
					`"${lookupTarget.handle.fullPath}"`,
				]
				// Report back an initial status, because it looks nice:
				workInProgress._reportProgress(sourceVersionHash, 0.1)

				ffMpegProcess = exec(args.join(' '), (err, _stdout, _stderr) => {
					ffMpegProcess = undefined
					if (err) {
						workInProgress._reportError(err)
						return
					}

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
				})
			}
		} else {
			throw new Error(
				`MediaFileScan.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}

		return workInProgress
	},
	removeExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<{ removed: boolean; reason: string }> => {
		if (!isMediaFileThumbnail(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		await lookupTarget.handle.removeMetadata()
		await lookupTarget.handle.removePackage()

		return { removed: true, reason: 'Removed thumbnail' }
	},
}
function isMediaFileThumbnail(exp: Expectation.Any): exp is Expectation.MediaFileThumbnail {
	return exp.type === Expectation.Type.MEDIA_FILE_THUMBNAIL
}

type LookupPackageContainer =
	| {
			accessor: AccessorOnPackage.Any
			handle: GenericAccessorHandle<Metadata>
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
async function lookupSources(
	worker: GenericWorker,
	exp: Expectation.MediaFileThumbnail
): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No source found'

	// See if the file is available at any of the sources:
	for (const packageContainer of exp.startRequirement.sources) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle<Metadata>(worker, accessor, exp.startRequirement.content)

			const issueAccessor = handle.checkHandleRead()
			if (issueAccessor) {
				errorReason = `${packageContainer.label}: lookupSources: Accessor "${accessorId}": ${issueAccessor}`
				continue // Maybe next source works?
			}

			const issuePackageContainer = await handle.checkPackageReadAccess()
			if (issuePackageContainer) {
				errorReason = `${packageContainer.label}: lookupSources: Accessor "${accessorId}": ${issuePackageContainer}`
				continue // Maybe next source works?
			}
			// Check that the file is of the right version:
			const actualSourceVersion = await handle.getPackageActualVersion()
			const fileVersionReason = compareActualExpectVersions(actualSourceVersion, exp.startRequirement.version)
			if (fileVersionReason) {
				errorReason = `${packageContainer.label}: lookupSources: Accessor "${accessorId}": ${fileVersionReason}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
					accessor: accessor,
					handle: handle,
					ready: true,
					reason: `Can access source "${packageContainer.label}" through accessor "${accessorId}"`,
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

/** Check that we have any access to a Package on an target-packageContainer, then return the packageContainer */
async function lookupTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFileThumbnail
): Promise<LookupPackageContainer> {
	/** undefined if all good, error string otherwise */
	let errorReason: undefined | string = 'No target found'

	// See if the file is available at any of the targets:
	for (const packageContainer of exp.endRequirement.targets) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			errorReason = undefined

			const handle = getAccessorHandle<Metadata>(worker, accessor, exp.endRequirement.content)

			const issueAccessor = handle.checkHandleWrite()
			if (issueAccessor) {
				errorReason = `${packageContainer.label}: Accessor "${accessorId}": ${issueAccessor}`
				continue // Maybe next source works?
			}

			if (!errorReason) {
				// All good, no need to look further:
				return {
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

interface Metadata {
	sourceVersionHash: string
	version: Expectation.Version.MediaFileThumbnail
}
