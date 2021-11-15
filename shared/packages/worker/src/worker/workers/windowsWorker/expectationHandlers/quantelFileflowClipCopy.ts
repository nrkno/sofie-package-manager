// import { GenericWorker } from '../../../worker'
// import { UniversalVersion, compareUniversalVersions, makeUniversalVersion, getStandardCost } from '../lib/lib'
// import { ExpectationWindowsHandler } from './expectationWindowsHandler'
// import {
// Accessor,
// AccessorOnPackage,
// PackageContainerOnPackage,
// 	hashObj,
// 	waitTime,
// 	Expectation,
// 	ReturnTypeDoYouSupportExpectation,
// 	ReturnTypeGetCostFortExpectation,
// 	ReturnTypeIsExpectationFullfilled,
// 	ReturnTypeIsExpectationReadyToStartWorkingOn,
// 	ReturnTypeRemoveExpectation,
// 	Reason,
// } from '@shared/api'
// import { isFileShareAccessorHandle, isQuantelClipAccessorHandle } from '../../../accessorHandlers/accessor'
// import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
// import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
// import { CancelablePromise } from '../../../lib/cancelablePromise'
// import { quantelFileflowCopy } from '../lib/quantelFileflow'

// /**
//  * Copies a file from one of the sources and into the target PackageContainer
//  */
// export const QuantelFileflowClipCopy: ExpectationWindowsHandler = {
// 	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
// 		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
// 			sources: exp.startRequirement.sources,
// 			targets: exp.endRequirement.targets,
// 		})
// 	},
// 	getCostForExpectation: async (
// 		exp: Expectation.Any,
// 		worker: GenericWorker
// 	): Promise<ReturnTypeGetCostFortExpectation> => {
// 		if (!isQuantelFileflowCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
// 		return getStandardCost(exp, worker)
// 	},
// 	isExpectationReadyToStartWorkingOn: async (
// 		exp: Expectation.Any,
// 		worker: GenericWorker
// 	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
// 		if (!isQuantelFileflowCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

// 		const lookupSource = await lookupCopySources(worker, exp)
// 		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
// 		const lookupTarget = await lookupCopyTargets(worker, exp)
// 		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

// 		const tryReading = await lookupSource.handle.tryPackageRead()
// 		if (!tryReading.success) return { ready: false, reason: tryReading.reason }

// 		return {
// 			ready: true,
// 			sourceExists: true,
// 		}
// 	},
// 	isExpectationFullfilled: async (
// 		exp: Expectation.Any,
// 		_wasFullfilled: boolean,
// 		worker: GenericWorker
// 	): Promise<ReturnTypeIsExpectationFullfilled> => {
// 		if (!isQuantelFileflowCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

// 		const lookupTarget = await lookupCopyTargets(worker, exp)
// 		if (!lookupTarget.ready)
// 			return {
// 				fulfilled: false,
// 				reason: {
// 					user: `Not able to access target, due to: ${lookupTarget.reason.user} `,
// 					tech: `Not able to access target: ${lookupTarget.reason.tech}`,
// 				},
// 			}

// 		const issuePackage = await lookupTarget.handle.checkPackageReadAccess()
// 		if (!issuePackage.success) {
// 			return {
// 				fulfilled: false,
// 				reason: {
// 					user: `Target package: ${issuePackage.reason.user}`,
// 					tech: `Target package: ${issuePackage.reason.tech}`,
// 				},
// 			}
// 		}

// 		// check that the file is of the right version:
// 		const actualTargetVersion = await lookupTarget.handle.fetchMetadata()
// 		if (!actualTargetVersion)
// 			return { fulfilled: false, reason: { user: `Target version is wrong`, tech: `Metadata missing` } }

// 		const lookupSource = await lookupCopySources(worker, exp)
// 		if (!lookupSource.ready) return { fulfilled: false, reason: lookupSource.reason }

// 		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

// 		const issueVersions = compareUniversalVersions(makeUniversalVersion(actualSourceVersion), actualTargetVersion)
// 		if (!issueVersions.success) {
// 			return { fulfilled: false, reason: issueVersions.reason }
// 		}

// 		return {
// 			fulfilled: true,
// 		}
// 	},
// 	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
// 		if (!isQuantelFileflowCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
// 		// Copies the file from Source to Target

// 		const startTime = Date.now()

// 		const lookupSource = await lookupCopySources(worker, exp)
// 		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

// 		const lookupTarget = await lookupCopyTargets(worker, exp)
// 		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

// 		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
// 		const actualSourceVersionHash = hashObj(actualSourceVersion)
// 		const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

// 		const sourceHandle = lookupSource.handle
// 		const targetHandle = lookupTarget.handle
// 		// if (
// 		// 	// Because the copying is performed by FileFlow, we only support
// 		// 	// file-share targets in the same network as Quantel:
// 		// 	lookupSource.accessor.type === Accessor.AccessType.QUANTEL &&
// 		// 	lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE &&
// 		// 	compareResourceIds(lookupSource.accessor.networkId, lookupTarget.accessor.networkId)
// 		// ) {
// 		// 	if (!isQuantelClipAccessorHandle(sourceHandle)) throw new Error(`Source AccessHandler type is wrong`)
// 		// 	if (!isFileShareAccessorHandle(targetHandle)) throw new Error(`Source AccessHandler type is wrong`)
// 		// 	if (!sourceHandle.fileflowURL) throw new Error(`Source AccessHandler does not have a Fileflow URL set`)
// 		// 	const fileflowURL = sourceHandle.fileflowURL
// 		// 	if (sourceHandle.zoneId === undefined) throw new Error(`Source AccessHandler does not have it's Zone ID set`)
// 		// 	const zoneId = sourceHandle.zoneId
// 		// 	const profile = sourceHandle.fileflowProfile

// 		// 	let wasCancelled = false
// 		// 	let copying: CancelablePromise<void> | undefined
// 		// 	const workInProgress = new WorkInProgress({ workLabel: 'Copying, using Quantel Fileflow' }, async () => {
// 		// 		// on cancel
// 		// 		wasCancelled = true
// 		// 		copying?.cancel()

// 		// 		// Wait a bit to allow freeing up of resources:
// 		// 		await waitTime(1000)

// 		// 		// Remove target files
// 		// 		await targetHandle.removePackage()
// 		// 	}).do(async () => {
// 		// 		await targetHandle.packageIsInPlace()

// 		// 		const sourceClip = await sourceHandle.getClip()
// 		// 		if (!sourceClip) {
// 		// 			throw new Error(`Could not fetch clip information from ${sourceHandle.accessorId}`)
// 		// 		}

// 		// 		const targetPath = exp.workOptions.useTemporaryFilePath ? targetHandle.temporaryFilePath : targetHandle.fullPath

// 		// 		copying = quantelFileflowCopy(
// 		// 			fileflowURL,
// 		// 			profile,
// 		// 			sourceClip.ClipID.toString(),
// 		// 			zoneId,
// 		// 			targetPath,
// 		// 			(progress: number) => {
// 		// 				workInProgress._reportProgress(actualSourceVersionHash, progress / 100)
// 		// 			}
// 		// 		)

// 		// 		await copying
// 		// 		// The copy is done at this point

// 		// 		copying = undefined
// 		// 		if (wasCancelled) return // ignore

// 		// 		await targetHandle.finalizePackage()
// 		// 		await targetHandle.updateMetadata(actualSourceUVersion)

// 		// 		const duration = Date.now() - startTime
// 		// 		workInProgress._reportComplete(
// 		// 			actualSourceVersionHash,
// 		// 			{
// 		// 				user: `Copy completed in ${Math.round(duration / 100) / 10}s`,
// 		// 				tech: `Copy completed at ${Date.now()}`,
// 		// 			},
// 		// 			undefined
// 		// 		)
// 		// 	})

// 		// 	return workInProgress
// 		} else {
// 			throw new Error(
// 				`QuantelFileflowClipCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
// 			)
// 		}
// 	},
// 	// removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
// 	// 	if (!isQuantelFileflowCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
// 	// 	// Remove the file on the location

// 	// 	const lookupTarget = await lookupCopyTargets(worker, exp)
// 	// 	if (!lookupTarget.ready) {
// 	// 		return {
// 	// 			removed: false,
// 	// 			reason: {
// 	// 				user: `Can't access target, due to: ${lookupTarget.reason.user}`,
// 	// 				tech: `No access to target: ${lookupTarget.reason.tech}`,
// 	// 			},
// 	// 		}
// 	// 	}

// 	// 	try {
// 	// 		await lookupTarget.handle.removePackage()
// 	// 	} catch (err) {
// 	// 		return {
// 	// 			removed: false,
// 	// 			reason: {
// 	// 				user: `Cannot remove file due to an internal error`,
// 	// 				tech: `Cannot remove file: ${stringifyError(err)}`,
// 	// 			},
// 	// 		}
// 	// 	}

// 	// 	return {
// 	// 		removed: true,
// 	// 	}
// 	// },
// }
// function isQuantelFileflowCopy(exp: Expectation.Any): exp is Expectation.QuantelFileflowClipCopy {
// 	return exp.type === Expectation.Type.QUANTEL_FILEFLOW_CLIP_COPY
// }

// function lookupCopySources(
// 	worker: GenericWorker,
// 	exp: Expectation.QuantelFileflowClipCopy
// ): Promise<LookupPackageContainer<QuantelMetadata>> {
// 	return lookupAccessorHandles<QuantelMetadata>(
// 		worker,
// 		exp.startRequirement.sources,
// 		exp.endRequirement.content,
// 		exp.workOptions,
// 		{
// 			read: true,
// 			readPackage: true,
// 			packageVersion: exp.endRequirement.version,
// 			customCheck: checkAccessorForQuantelFileflow,
// 		}
// 	)
// }
// function lookupCopyTargets(
// 	worker: GenericWorker,
// 	exp: Expectation.QuantelFileflowClipCopy
// ): Promise<LookupPackageContainer<UniversalVersion>> {
// 	return lookupAccessorHandles<UniversalVersion>(
// 		worker,
// 		exp.endRequirement.targets,
// 		exp.endRequirement.content,
// 		exp.workOptions,
// 		{
// 			write: true,
// 			writePackageContainer: true,
// 		}
// 	)
// }

// // eslint-disable-next-line @typescript-eslint/no-empty-interface
// interface QuantelMetadata {
// 	// nothing?
// }
