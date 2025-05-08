import { BaseWorker } from '../../../worker'
import { UniversalVersion, compareUniversalVersions, makeUniversalVersion, getStandardCost } from '../lib/lib'
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
import {
	isCorePackageInfoAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { PackageReadStream, PutPackageHandler } from '../../../accessorHandlers/genericHandle'
import { PackageInfoType } from './lib/coreApi'
import { ExpectationHandlerGenericWorker } from '../genericWorker'

/**
 * Copies a file from one of the sources and into the target PackageContainer
 */
export const JsonDataCopy: ExpectationHandlerGenericWorker = {
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
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready)
			return {
				ready: lookupSource.ready,
				sourceExists: false,
				reason: lookupSource.reason,
				knownReason: lookupSource.knownReason,
			}
		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready)
			return { ready: lookupTarget.ready, reason: lookupTarget.reason, knownReason: lookupTarget.knownReason }

		// Also check if we actually can read from the package,
		// this might help in some cases if the file is currently transferring
		const tryReading = await lookupSource.handle.tryPackageRead()
		if (!tryReading.success)
			return {
				ready: false,
				sourceExists: tryReading.packageExists,
				reason: tryReading.reason,
				knownReason: tryReading.knownReason,
			}

		return {
			ready: true,
		}
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

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
		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, knownReason: lookupSource.knownReason, reason: lookupSource.reason }

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		if (isCorePackageInfoAccessorHandle(lookupTarget.handle)) {
			const packageInfoSynced = await lookupTarget.handle.findUnUpdatedPackageInfo(
				PackageInfoType.JSON,
				exp,
				{}, // exp.startRequirement.content,
				actualSourceVersion,
				exp.endRequirement.version
			)
			if (packageInfoSynced.needsUpdate) {
				if (wasFulfilled) {
					// Remove the outdated result:
					await lookupTarget.handle.removePackageInfo(
						PackageInfoType.JSON,
						exp,
						'in isExpectationFulfilled, needsUpdate'
					)
				}
				return { fulfilled: false, knownReason: true, reason: packageInfoSynced.reason }
			} else {
				return { fulfilled: true }
			}
		} else {
			// check that the file is of the right version:
			const actualTargetUVersion = await lookupTarget.handle.fetchMetadata()
			// const actualTargetVersion = await lookupTarget.handle.getPackageActualVersion()
			if (!actualTargetUVersion)
				return {
					fulfilled: false,
					knownReason: true,
					reason: { user: `Target version is wrong`, tech: `Metadata missing` },
				}

			const issueVersions = compareUniversalVersions(
				makeUniversalVersion(actualSourceVersion),
				actualTargetUVersion
			)
			if (!issueVersions.success) {
				return { fulfilled: false, knownReason: issueVersions.knownReason, reason: issueVersions.reason }
			}
		}

		return {
			fulfilled: true,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const timer = startTimer()

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)
		const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

		// const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle
		if (
			lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
			lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
			lookupSource.accessor.type === Accessor.AccessType.HTTP ||
			lookupSource.accessor.type === Accessor.AccessType.HTTP_PROXY
		) {
			if (
				!isLocalFolderAccessorHandle(lookupSource.handle) &&
				!isFileShareAccessorHandle(lookupSource.handle) &&
				!isHTTPAccessorHandle(lookupSource.handle) &&
				!isHTTPProxyAccessorHandle(lookupSource.handle)
			)
				throw new Error(`Source AccessHandler type is wrong`)

			if (lookupTarget.accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO) {
				// Copy the JSON data into Core PackageInfo

				if (!isCorePackageInfoAccessorHandle(targetHandle)) {
					throw new Error(`Target AccessHandler type is wrong`)
				}

				let wasCancelled = false
				let sourceStream: PackageReadStream | undefined = undefined
				const workInProgress = new WorkInProgress({ workLabel: 'Copying, using streams' }, async () => {
					// on cancel work
					wasCancelled = true

					sourceStream?.cancel()
				}).do(async () => {
					workInProgress._reportProgress(actualSourceVersionHash, 0.1)

					if (wasCancelled) return

					sourceStream = await lookupSource.handle.getPackageReadStream()

					workInProgress._reportProgress(actualSourceVersionHash, 0.5)

					// Special: read the stream into memory and create JSON from it:
					const readChunks: Buffer[] = []
					sourceStream.readStream.on('data', (data) => {
						if (wasCancelled) return
						workInProgress._reportProgress(actualSourceVersionHash, 0.6)
						readChunks.push(data)
					})
					sourceStream.readStream.on('error', (error) => {
						workInProgress._reportError(error)
					})
					sourceStream.readStream.on('end', () => {
						if (wasCancelled) return

						Promise.resolve()
							.then(async () => {
								workInProgress._reportProgress(actualSourceVersionHash, 0.7)

								const jsonString = Buffer.concat(readChunks).toString('utf8')

								let jsonData: any = undefined
								try {
									jsonData = JSON.parse(jsonString)
								} catch (err) {
									throw new Error(`Error parsing JSON: ${err}`)
								}
								const saveOperation = await targetHandle.prepareForOperation(
									'Copy JSON.Data',
									lookupSource.handle
								)

								await targetHandle.updatePackageInfo(
									PackageInfoType.JSON,
									exp,
									{}, // exp.startRequirement.content,
									actualSourceVersion,
									exp.endRequirement.version,
									jsonData
								)
								await targetHandle.finalizePackage(saveOperation)

								if (wasCancelled) return
								const duration = timer.get()
								workInProgress._reportComplete(
									actualSourceVersionHash,
									{
										user: `Copy completed in ${Math.round(duration / 100) / 10}s`,
										tech: `Completed at ${Date.now()}`,
									},
									undefined
								)
							})
							.catch((error) => {
								workInProgress._reportError(error)
							})
					})
				})

				return workInProgress
			} else if (
				lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY
			) {
				// We can copy by using streams.
				if (
					!isLocalFolderAccessorHandle(targetHandle) &&
					!isFileShareAccessorHandle(targetHandle) &&
					!isHTTPProxyAccessorHandle(targetHandle)
				) {
					throw new Error(`Target AccessHandler type is wrong`)
				}

				let wasCancelled = false
				let sourceStream: PackageReadStream | undefined = undefined
				let writeStream: PutPackageHandler | undefined = undefined
				const workInProgress = new WorkInProgress({ workLabel: 'Copying, using streams' }, async () => {
					// on cancel work
					wasCancelled = true
					await new Promise<void>((resolve, reject) => {
						writeStream?.once('close', () => {
							targetHandle
								.removePackage('work cancelled')
								.then(() => resolve())
								.catch((err) => reject(err))
						})
						sourceStream?.cancel()
						writeStream?.abort()
					})
				}).do(async () => {
					workInProgress._reportProgress(actualSourceVersionHash, 0.1)

					if (wasCancelled) return
					const fileOperation = await targetHandle.prepareForOperation('Copy JSON.Data', lookupSource.handle)
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
								await targetHandle.finalizePackage(fileOperation)
								await targetHandle.updateMetadata(actualSourceUVersion)

								const duration = timer.get()
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
			}
		}
		// else:
		throw new Error(
			`JsonDataCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
		)
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isJsonDataCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

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
			if (isCorePackageInfoAccessorHandle(lookupTarget.handle)) {
				await lookupTarget.handle.removePackageInfo(PackageInfoType.JSON, exp, reason)
			} else {
				await lookupTarget.handle.removePackage(reason)
			}
		} catch (err) {
			return {
				removed: false,
				knownReason: false,
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

async function lookupCopySources(
	worker: BaseWorker,
	exp: Expectation.JsonDataCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
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
	exp: Expectation.JsonDataCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
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
