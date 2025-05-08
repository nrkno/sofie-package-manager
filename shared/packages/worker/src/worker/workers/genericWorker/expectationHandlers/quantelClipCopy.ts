import { BaseWorker } from '../../../worker'
import { compareUniversalVersions, getStandardCost, makeUniversalVersion } from '../lib/lib'
import {
	Accessor,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	stringifyError,
	startTimer,
} from '@sofie-package-manager/api'
import { isQuantelClipAccessorHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { ExpectationHandlerGenericWorker } from '../genericWorker'

export const QuantelClipCopy: ExpectationHandlerGenericWorker = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: BaseWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isQuantelClipCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isQuantelClipCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready)
			return {
				ready: lookupSource.ready,
				knownReason: lookupSource.knownReason,
				sourceExists: false,
				reason: lookupSource.reason,
			}
		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready)
			return { ready: lookupTarget.ready, knownReason: lookupTarget.knownReason, reason: lookupTarget.reason }

		if (lookupTarget.accessor.type === Accessor.AccessType.QUANTEL) {
			if (!lookupTarget.accessor.serverId)
				return {
					ready: false,
					knownReason: true,
					reason: {
						user: `There is an issue in the settings: The Accessor "${lookupTarget.handle.accessorId}" has no serverId set`,
						tech: `Target Accessor "${lookupTarget.handle.accessorId}" has no serverId set`,
					},
				}
		}

		// // Do a check, to ensure that the source and targets are Quantel:
		// if (lookupSource.accessor.type !== Accessor.AccessType.QUANTEL)
		// 	return { ready: false, reason: `Source Accessor type not supported: ${lookupSource.accessor.type}` }
		// if (lookupTarget.accessor.type !== Accessor.AccessType.QUANTEL)
		// 	return { ready: false, reason: `Target Accessor type not supported: ${lookupSource.accessor.type}` }

		// Also check if we actually can read from the package:
		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success)
			return {
				ready: false,
				knownReason: tryReading.knownReason,
				sourceExists: tryReading.packageExists,
				isPlaceholder: tryReading.sourceIsPlaceholder,
				reason: tryReading.reason,
			}

		return {
			ready: true,
		}
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		_wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isQuantelClipCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
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

		// Does the clip exist on the target?
		const actualTargetVersion = await lookupTarget.handle.getPackageActualVersion()
		if (!actualTargetVersion)
			return {
				fulfilled: false,
				knownReason: true,
				reason: { user: `No clip found on target`, tech: `No clip found on target` },
			}

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, knownReason: lookupSource.knownReason, reason: lookupSource.reason }

		// Check if we actually can read from the source package:
		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success)
			return { fulfilled: false, knownReason: tryReading.knownReason, reason: tryReading.reason }

		// Check that the target clip is of the right version:
		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		const issueVersions = compareUniversalVersions(
			makeUniversalVersion(actualSourceVersion),
			makeUniversalVersion(actualTargetVersion)
		)
		if (!issueVersions.success) {
			return { fulfilled: false, knownReason: issueVersions.knownReason, reason: issueVersions.reason }
		}

		return {
			fulfilled: true,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isQuantelClipCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the clip from Source to Target

		const timer = startTimer()

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
			lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
			lookupTarget.accessor.type === Accessor.AccessType.QUANTEL
		) {
			// We can copy by using internal Quantel copy
			if (!isQuantelClipAccessorHandle(sourceHandle))
				throw new Error(`Source AccessHandler type is wrong (${sourceHandle.type})`)
			if (!isQuantelClipAccessorHandle(targetHandle))
				throw new Error(`Source AccessHandler type is wrong (${targetHandle.type})`)

			let wasCancelled = false
			let wasCompleted = false
			const workInProgress = new WorkInProgress({ workLabel: 'Copying Quantel clip' }, async () => {
				// on cancel work
				wasCancelled = true
				await new Promise<void>((resolve, reject) => {
					putPackageHandler.once('close', () => {
						targetHandle
							.removePackage('work cancelled')
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
					const sourceClip = await sourceHandle.getPackageActualVersion()

					if (wasCancelled || wasCompleted) return
					let targetClip: Expectation.Version.Any | null = null
					try {
						targetClip = await targetHandle.getPackageActualVersion()
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
			const sourceReadInfo = await sourceHandle.getPackageReadInfo()
			const quantelOperation = await targetHandle.prepareForOperation('Copy clip', lookupSource.handle)

			const putPackageHandler = await targetHandle.putPackageInfo(sourceReadInfo.readInfo)

			putPackageHandler.on('error', (err) => {
				workInProgress._reportError(err)
			})
			putPackageHandler.once('close', () => {
				if (wasCancelled || wasCompleted) return // ignore
				wasCompleted = true
				setImmediate(() => {
					// Copying is done
					;(async () => {
						await targetHandle.finalizePackage(quantelOperation)
						await targetHandle.updateMetadata(actualSourceUVersion)

						const duration = timer.get()
						workInProgress._reportComplete(
							actualSourceVersionHash,
							{
								user: `Copy completed in ${Math.round(duration / 100) / 10}s`,
								tech: `Completed at ${Date.now()}`,
							},
							undefined
						)
					})().catch((err) => {
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
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isQuantelClipCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the clip on the location

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) {
			return {
				removed: false,
				knownReason: lookupTarget.knownReason,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		}

		try {
			await lookupTarget.handle.removePackage(reason)
		} catch (err) {
			return {
				removed: false,
				knownReason: false,
				reason: {
					user: `Cannot remove clip due to an internal error`,
					tech: `Cannot remove preview clip: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
		}
	},
}
function isQuantelClipCopy(exp: Expectation.Any): exp is Expectation.QuantelClipCopy {
	return exp.type === Expectation.Type.QUANTEL_CLIP_COPY
}

async function lookupCopySources(
	worker: BaseWorker,
	exp: Expectation.QuantelClipCopy
): Promise<LookupPackageContainer<QuantelMetadata>> {
	return lookupAccessorHandles<QuantelMetadata>(
		worker,
		exp.startRequirement.sources,
		{ expectationId: exp.id },
		exp.endRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.endRequirement.version,
		}
	)
}
async function lookupCopyTargets(
	worker: BaseWorker,
	exp: Expectation.QuantelClipCopy
): Promise<LookupPackageContainer<QuantelMetadata>> {
	return lookupAccessorHandles<QuantelMetadata>(
		worker,
		exp.endRequirement.targets,
		{ expectationId: exp.id },
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
