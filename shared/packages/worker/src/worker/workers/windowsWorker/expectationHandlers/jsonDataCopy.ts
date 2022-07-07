import { GenericWorker } from '../../../worker'
import { UniversalVersion, compareUniversalVersions, makeUniversalVersion, getStandardCost } from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	Accessor,
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	stringifyError,
} from '@sofie-package-manager/api'
import {
	isCorePackageInfoAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { PackageReadStream, PutPackageHandler } from '../../../accessorHandlers/genericHandle'

/**
 * Copies a file from one of the sources and into the target PackageContainer
 */
export const JsonDataCopy: ExpectationWindowsHandler = {
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
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, sourceExists: false, reason: lookupSource.reason }
		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		// Also check if we actually can read from the package,
		// this might help in some cases if the file is currently transferring
		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success) return { ready: false, reason: tryReading.reason }

		return {
			ready: true,
			sourceExists: true,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		_wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

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
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const startTime = Date.now()

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)
		// const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

		// const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle
		if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP) &&
			lookupTarget.accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO
		) {
			// We can copy by using streams:
			if (
				!isLocalFolderAccessorHandle(lookupSource.handle) &&
				!isFileShareAccessorHandle(lookupSource.handle) &&
				!isHTTPProxyAccessorHandle(lookupSource.handle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (!isCorePackageInfoAccessorHandle(targetHandle)) throw new Error(`Source AccessHandler type is wrong`)

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
				workInProgress._reportProgress(actualSourceVersionHash, 0.1)

				if (wasCancelled) return
				sourceStream = await lookupSource.handle.getPackageReadStream()
				writeStream = await targetHandle.putPackageStream(sourceStream.readStream)

				workInProgress._reportProgress(actualSourceVersionHash, 0.5)

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
							// await targetHandle.updateMetadata()

							const duration = Date.now() - startTime
							workInProgress._reportComplete(
								actualSourceVersionHash,
								{
									user: `Completed in ${Math.round(duration / 100) / 10}s`,
									tech: `Completed at ${Date.now()}`,
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
		} else {
			throw new Error(
				`JsonDataCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
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
					user: `Cannot remove json-data due to an internal error`,
					tech: `Cannot remove json-data: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
			// reason: `Removed file "${exp.endRequirement.content.filePath}" from target`
		}
	},
}
function isJsonDataCopy(exp: Expectation.Any): exp is Expectation.JsonDataCopy {
	return exp.type === Expectation.Type.JSON_DATA_COPY
}

function lookupCopySources(
	worker: GenericWorker,
	exp: Expectation.JsonDataCopy
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
	exp: Expectation.JsonDataCopy
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
