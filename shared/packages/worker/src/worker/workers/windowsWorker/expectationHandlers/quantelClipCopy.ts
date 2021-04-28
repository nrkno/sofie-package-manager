import { Accessor } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../../../worker'
import { compareUniversalVersions, makeUniversalVersion } from '../lib/lib'
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
import { isQuantelClipAccessorHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'

export const QuantelClipCopy: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		_worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isQuantelFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		// Because we really only support one accessor, let's just return a fix cost..

		return 30
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isQuantelFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		if (lookupTarget.accessor.type === Accessor.AccessType.QUANTEL) {
			if (!lookupTarget.accessor.serverId) return { ready: false, reason: `Target Accessor has no serverId set` }
		}

		// // Do a check, to ensure that the source and targets are Quantel:
		// if (lookupSource.accessor.type !== Accessor.AccessType.QUANTEL)
		// 	return { ready: false, reason: `Source Accessor type not supported: ${lookupSource.accessor.type}` }
		// if (lookupTarget.accessor.type !== Accessor.AccessType.QUANTEL)
		// 	return { ready: false, reason: `Target Accessor type not supported: ${lookupSource.accessor.type}` }

		// Also check if we actually can read from the package:
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
		if (!isQuantelFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
		if (issuePackage) {
			return { fulfilled: false, reason: `Clip not found: ${issuePackage.toString()}` }
		}

		// Does the clip exist on the target?
		const actualTargetVersion = await lookupTarget.handle.getPackageActualVersion()
		if (!actualTargetVersion) return { fulfilled: false, reason: `No package found on target` }

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		// Check that the target clip is of the right version:

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		const issueVersions = compareUniversalVersions(
			makeUniversalVersion(actualSourceVersion),
			makeUniversalVersion(actualTargetVersion)
		)
		if (issueVersions) {
			return { fulfilled: false, reason: issueVersions }
		}

		return {
			fulfilled: true,
			reason: `File "${
				exp.endRequirement.content.guid || exp.endRequirement.content.title
			}" already exists on target`,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isQuantelFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
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
			lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
			lookupTarget.accessor.type === Accessor.AccessType.QUANTEL
		) {
			// We can copy by using internal Quantel copy
			if (!isQuantelClipAccessorHandle(lookupSource.handle))
				throw new Error(`Source AccessHandler type is wrong (${lookupSource.handle.type})`)
			if (!isQuantelClipAccessorHandle(lookupTarget.handle))
				throw new Error(`Source AccessHandler type is wrong (${lookupTarget.handle.type})`)

			let wasCancelled = false
			let wasCompleted = false
			const workInProgress = new WorkInProgress({ workLabel: 'Copying Quantel clip' }, async () => {
				// on cancel work
				wasCancelled = true
				await new Promise<void>((resolve, reject) => {
					putPackageHandler.once('close', () => {
						lookupTarget.handle
							.removePackage()
							.then(() => lookupTarget.handle.removeMetadata())
							.then(() => resolve())
							.catch((err) => reject(err))
					})
					sourceReadInfo.cancel()
					putPackageHandler.abort()
				})
			})

			const updateProgress = setInterval(() => {
				if (wasCancelled || wasCompleted) {
					clearInterval(updateProgress)
					return
				}

				;(async () => {
					if (wasCancelled || wasCompleted) return
					const sourceClip = await lookupSource.handle.getPackageActualVersion()

					if (wasCancelled || wasCompleted) return
					let targetClip: Expectation.Version.Any | null = null
					try {
						targetClip = await lookupTarget.handle.getPackageActualVersion()
					} catch (err) {
						if ((err + '').match(/not found/i)) {
							// not found, that's okay
						} else {
							throw err
						}
					}

					if (wasCancelled || wasCompleted) return
					if (sourceClip) {
						if (targetClip) {
							if (
								sourceClip.type === Expectation.Version.Type.QUANTEL_CLIP &&
								targetClip.type === Expectation.Version.Type.QUANTEL_CLIP
							) {
								if (targetClip.frames) {
									workInProgress._reportProgress(
										actualSourceVersionHash,
										sourceClip.frames / targetClip.frames
									)
								}
							}
						} else {
							workInProgress._reportProgress(actualSourceVersionHash, 0)
						}
					}
				})().catch((err) => {
					workInProgress._reportError(err)
				})
			}, 100)

			const sourceReadInfo = await lookupSource.handle.getPackageReadInfo()
			const putPackageHandler = await lookupTarget.handle.putPackageInfo(sourceReadInfo.readInfo)

			putPackageHandler.on('error', (err) => {
				workInProgress._reportError(err)
			})
			putPackageHandler.once('close', () => {
				if (wasCancelled || wasCompleted) return // ignore
				wasCompleted = true
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
				`QuantelClipCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isQuantelFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
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

		return {
			removed: true,
			reason: `Removed file "${exp.endRequirement.content.guid || exp.endRequirement.content.title}" from target`,
		}
	},
}
function isQuantelFileCopy(exp: Expectation.Any): exp is Expectation.QuantelClipCopy {
	return exp.type === Expectation.Type.QUANTEL_CLIP_COPY
}

function lookupCopySources(
	worker: GenericWorker,
	exp: Expectation.QuantelClipCopy
): Promise<LookupPackageContainer<QuantelMetadata>> {
	return lookupAccessorHandles<QuantelMetadata>(
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
	exp: Expectation.QuantelClipCopy
): Promise<LookupPackageContainer<QuantelMetadata>> {
	return lookupAccessorHandles<QuantelMetadata>(
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

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface QuantelMetadata {
	// nothing?
}
