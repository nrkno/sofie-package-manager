import { BaseWorker } from '../../../worker'
import { getStandardCost, makeUniversalVersion, UniversalVersion } from '../lib/lib'
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
	PackageContainerId,
	protectString,
	AccessorId,
	PackageContainerOnPackage,
	AccessorOnPackage,
	escapeFilePath,
	PackageContainerExpectation,
	LoggerInstance,
	startTimer,
	ExpectedPackage,
} from '@sofie-package-manager/api'
import {
	isFileShareAccessorHandle,
	isFTPAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
	isS3AccessorHandle,
} from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { ExpectationHandlerGenericWorker, GenericWorker } from '../genericWorker'
import { GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import { doFileCopyExpectation, isFileFulfilled } from './lib/file'
import { ProgressPart, ProgressParts } from '../lib/progressParts'

import path from 'path'
import { SpawnedProcess, spawnProcess } from './lib/spawnProcess'

/**
 * Generates a low-res preview video of a source video file, and stores the resulting file into the target PackageContainer
 */
export const MediaFileConvert: ExpectationHandlerGenericWorker = {
	async doYouSupportExpectation(
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeDoYouSupportExpectation> {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		for (const conversion of exp.endRequirement.version.conversions) {
			{
				// Check that the executable alias is defined in config:
				const executable = worker.getExecutable(conversion.executable)

				if (!executable) {
					return {
						support: false,
						knownReason: true,
						reason: {
							user: `There is an issue with the Worker, the alias "${conversion.executable}" is not configured`,
							tech: `The conversion alias "${
								conversion.executable
							}" is not found in the worker configuration (check CLI argument --executableAliases) (${JSON.stringify(
								worker.agentAPI.config.executableAliases
							)})`,
						},
					}
				}

				// Check that the executable is actually accessible:
				const status = await worker.executables.getExecutableStatus(executable)
				if (status !== null) {
					return {
						support: false,
						knownReason: true,
						reason: {
							user: `There is an issue with the Worker ("${executable}" not found)`,
							tech: `Cannot access "${executable}" on the worker. Reason: ${status}`,
						},
					}
				}
			}

			if (conversion.preChecks) {
				for (const preCheck of conversion.preChecks) {
					// Check that the executable alias is defined in config:
					const executable = worker.getExecutable(preCheck.executable)

					// Check that the executable is actually accessible:
					if (!executable) {
						return {
							support: false,
							knownReason: true,
							reason: {
								user: `There is an issue with the Worker, the alias "${preCheck.executable}" is not configured`,
								tech: `The preCheck alias "${
									preCheck.executable
								}" is not found in the worker configuration (check CLI argument --executableAliases) (${JSON.stringify(
									worker.agentAPI.config.executableAliases
								)})`,
							},
						}
					}

					const status = await worker.executables.getExecutableStatus(executable)
					if (status !== null) {
						return {
							support: false,
							knownReason: true,
							reason: {
								user: `There is an issue with the Worker ("${executable}" not found)`,
								tech: `Cannot access "${executable}" on the worker. Reason: ${status}`,
							},
						}
					}
				}
			}
		}

		return checkWorkerHasAccessToPackageContainersOnPackage(worker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupConvertSources(worker, exp)
		if (!lookupSource.ready)
			return {
				ready: lookupSource.ready,
				knownReason: lookupSource.knownReason,
				sourceExists: false,
				reason: lookupSource.reason,
			}
		const lookupTarget = await lookupConvertTargets(worker, exp)
		if (!lookupTarget.ready)
			return { ready: lookupTarget.ready, knownReason: lookupTarget.knownReason, reason: lookupTarget.reason }

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
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		_wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupConvertSources(worker, exp)
		const lookupTarget = await lookupConvertTargets(worker, exp)

		const fulfilled = await isFileFulfilled(worker, lookupSource, lookupTarget, (sourceUVersion) => {
			// Extend the source version with the conversion parameters:
			extendUVersion(sourceUVersion, exp)
			return sourceUVersion
		})
		// Ensure that the target Package is staying Fulfilled:
		if (fulfilled.fulfilled && lookupTarget.ready) await lookupTarget.handle.ensurePackageFulfilled()
		return fulfilled
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const timer = startTimer()

		const lookupSource = await lookupConvertSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupConvertTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const sourceHandle = lookupSource.handle
		const targetHandle = lookupTarget.handle

		if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP_PROXY ||
				lookupSource.accessor.type === Accessor.AccessType.FTP ||
				lookupSource.accessor.type === Accessor.AccessType.S3) &&
			(lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY ||
				lookupTarget.accessor.type === Accessor.AccessType.FTP ||
				lookupTarget.accessor.type === Accessor.AccessType.S3)
		) {
			// We can read the source and write the preview directly.
			if (
				!isLocalFolderAccessorHandle(sourceHandle) &&
				!isFileShareAccessorHandle(sourceHandle) &&
				!isHTTPAccessorHandle(sourceHandle) &&
				!isHTTPProxyAccessorHandle(sourceHandle) &&
				!isFTPAccessorHandle(sourceHandle) &&
				!isS3AccessorHandle(sourceHandle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(targetHandle) &&
				!isFileShareAccessorHandle(targetHandle) &&
				!isHTTPProxyAccessorHandle(targetHandle) &&
				!isFTPAccessorHandle(targetHandle) &&
				!isS3AccessorHandle(targetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			let mediaConversion: MediaConversion | null = null

			const workInProgress = new WorkInProgress({ workLabel: 'Converting media file...' }, async () => {
				// On cancel
				mediaConversion
					?.cancel()
					.catch((err) => worker.logger.error(`Error cancelling mediaConversion: ${stringifyError(err)}`))
			}).do(async () => {
				const progressTracker = new ProgressParts()
				progressTracker.on('progress', (p) => {
					workInProgress._reportProgress(actualSourceVersionHash, p)
				})
				const progressSetup = progressTracker.addPart(1)
				const progressFinalize = progressTracker.addPart(1)

				const tryReadPackage = await sourceHandle.checkPackageReadAccess()
				if (!tryReadPackage.success) throw new Error(tryReadPackage.reason.tech)

				const actualSourceVersion = await sourceHandle.getPackageActualVersion()
				const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)
				extendUVersion(actualSourceUVersion, exp)
				const actualSourceVersionHash = hashObj(actualSourceUVersion)

				await targetHandle.removePackage('Prepare for media file generation')

				const fileOperation = await targetHandle.prepareForOperation('Convert Media file', lookupSource.handle)

				progressSetup(1)

				if (!isLookupFilePackageContainer(lookupSource))
					throw new Error(`Source is not a file-based PackageContainer`)
				if (!isLookupFilePackageContainer(lookupTarget))
					throw new Error(`Target is not a file-based PackageContainer`)

				mediaConversion = new MediaConversion(
					worker,
					progressTracker,
					exp,
					lookupSource,
					lookupTarget,
					workInProgress
				)
				await mediaConversion.work()
				mediaConversion = null

				// Overwrite target metadata:
				await targetHandle.updateMetadata(actualSourceUVersion)
				await targetHandle.finalizePackage(fileOperation)

				progressFinalize(1)

				const duration = timer.get()
				workInProgress._reportComplete(
					actualSourceVersionHash,
					{
						user: `Conversion completed in ${Math.round(duration / 100) / 10}s`,
						tech: `Completed at ${Date.now()}`,
					},
					undefined
				)
			})

			return workInProgress
		} else {
			throw new Error(
				`MediaFileConvert.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFileConvert(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupConvertTargets(worker, exp)
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
					user: `Cannot remove file due to an internal error`,
					tech: `Cannot remove preview file: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
			// reason: { user: ``, tech: `Removed preview file "${exp.endRequirement.content.filePath}" from target` },
		}
	},
}
function isMediaFileConvert(exp: Expectation.Any): exp is Expectation.MediaFileConvert {
	return exp.type === Expectation.Type.MEDIA_FILE_CONVERT
}

function extendUVersion(sourceUVersion: UniversalVersion, exp: Expectation.MediaFileConvert) {
	// Extend the source version with the conversion parameters:
	sourceUVersion['conversions'] = {
		name: 'Conversions',
		value: JSON.stringify(exp.endRequirement.version.conversions),
	}
}

async function lookupConvertSources(
	worker: BaseWorker,
	exp: Expectation.MediaFileConvert
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		'Source',
		worker,
		exp.startRequirement.sources,
		exp.endRequirement.targets,
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
async function lookupConvertTargets(
	worker: BaseWorker,
	exp: Expectation.MediaFileConvert
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		'Target',
		worker,
		exp.endRequirement.targets,
		exp.startRequirement.sources,
		{ expectationId: exp.id },
		exp.endRequirement.content,
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}

export type LookupFilePackageContainer<Metadata> = {
	ready: true
	accessor:
		| AccessorOnPackage.LocalFolder
		| AccessorOnPackage.FileShare
		| AccessorOnPackage.HTTP
		| AccessorOnPackage.HTTPProxy
		| AccessorOnPackage.Quantel

	handle: GenericAccessorHandle<Metadata>
}
function isLookupFilePackageContainer<T>(lookup: LookupPackageContainer<T>): lookup is LookupFilePackageContainer<T> {
	return (
		lookup.ready &&
		(isLocalFolderAccessorHandle(lookup.handle) ||
			isFileShareAccessorHandle(lookup.handle) ||
			isHTTPAccessorHandle(lookup.handle) ||
			isHTTPProxyAccessorHandle(lookup.handle) ||
			isFTPAccessorHandle(lookup.handle) ||
			isS3AccessorHandle(lookup.handle))
	)
}

/**
 * A fleeting instance to handle media conversions.
 * This class is instantiated, then work() is called, then the instance is discarded.
 */
class MediaConversion {
	/**
	 * Pointer to the current source of the operation
	 */

	private localPackageContainerIndex = -1
	public readonly workId: string

	/** Currently running operation, if any. Used for cancelling. */
	private currentOperation: MediaConversionOperation | null = null

	private logger: LoggerInstance
	constructor(
		public worker: BaseWorker,
		public progressTracker: ProgressParts,
		public exp: Expectation.MediaFileConvert,
		public lookupSource: LookupFilePackageContainer<UniversalVersion>,
		public lookupTarget: LookupFilePackageContainer<UniversalVersion>,
		public workInProgress: WorkInProgress
	) {
		this.logger = worker.logger.category('MediaConversion')
		this.workId = Math.random().toString(36).substring(2, 7)
	}

	public async cancel(): Promise<void> {
		if (this.currentOperation) {
			await this.currentOperation.cancel()
		}
	}

	public async work() {
		const conversions = this.exp.endRequirement.version.conversions

		if (conversions.length === 0) throw new Error(`No conversion operations defined`)

		// Prepare the operations:
		const operations: MediaConversionOperation[] = []
		let prevOperation: MediaConversionOperation | null = null

		for (let i = 0; i < this.exp.endRequirement.version.conversions.length; i++) {
			const conversion = this.exp.endRequirement.version.conversions[i]
			const isFinalStep = i === this.exp.endRequirement.version.conversions.length - 1

			const operation: MediaConversionOperation = new MediaConversionOperation(
				this.worker,
				this.logger.category(`Step ${i + 1}`),
				this,
				prevOperation,
				this.exp,
				conversion,
				isFinalStep
			)
			operations.push(operation)
			prevOperation = operation
		}

		// Set up an OperationPointer.
		// This points to the current file source and as the work progresses, the pointer is updated to point to the resulting files
		let operationPointer: OperationPointer = {
			lookup: this.lookupSource,
			packageContainer: {
				accessors: { [this.lookupSource.handle.accessorId]: this.lookupSource.accessor },
				containerId: protectString('N/A'),
				label: 'Source',
			},
			isTemporary: false,
			isSource: true,
		}

		// Execute the operations:
		for (const operation of operations) {
			this.currentOperation = operation
			const nextOperationPointer = await operation.work(operationPointer)
			this.currentOperation = null

			// Change the pointer so that the next operation will use the new pointer:
			operationPointer = nextOperationPointer
		}
	}

	public getLocalPackageContainer(): {
		packageContainer: Expectation.SpecificPackageContainerOnPackage.FileSource
		exp: PackageContainerExpectation
	} {
		this.localPackageContainerIndex++
		const localPath = `source${this.localPackageContainerIndex}`
		const accessorId = protectString<AccessorId>('local')
		const accessor: Accessor.LocalFolder = {
			type: Accessor.AccessType.LOCAL_FOLDER,
			label: 'Local temporary folder',
			folderPath: this.worker.getTemporaryFolderPath(localPath),
			allowRead: true,
			allowWrite: true,
		}
		const packageContainer: Expectation.SpecificPackageContainerOnPackage.FileSource = {
			label: `Local temp ${localPath}`,
			containerId: protectString<PackageContainerId>(`__local-temp-${localPath}`),
			accessors: { [accessorId]: accessor },
		}

		const exp: PackageContainerExpectation = {
			...packageContainer,
			id: packageContainer.containerId,
			cronjobs: {
				// Cleanup files due for removal:
				cleanup: {
					label: 'Cleanup temporary files',
					// Remove untracked files as well:
					cleanFileAge: 30 * 60, // files older than 30 minutes (in seconds)
				},
			},
			managerId: protectString('tmp_convert'),
			monitors: {},
			accessors: { [accessorId]: accessor },
		}
		return { packageContainer, exp }
	}
}
class MediaConversionOperation {
	private reportPrepareLocal: ProgressPart
	private reportFinalizeLocal: ProgressPart
	private reportPreChecks: ProgressPart[] = []
	private reportPrepare: ProgressPart
	private reportProgress: ProgressPart
	private reportFinalize: ProgressPart

	private subWorkInProgress: IWorkInProgress | null = null
	private spawnedProcess: SpawnedProcess | undefined = undefined

	private anyNeedsLocalSource(): boolean {
		if (this.conversion.needsLocalSource) return true

		for (const preCheck of this.conversion.preChecks ?? []) {
			if (preCheck.needsLocalSource) return true
		}

		return false
	}

	constructor(
		private worker: BaseWorker,
		private logger: LoggerInstance,
		private parent: MediaConversion,
		previousOperation: MediaConversionOperation | null,
		private exp: Expectation.MediaFileConvert,
		private conversion: ExpectedPackage.ConversionStep,
		private isFinalStep: boolean
	) {
		const isFirst = previousOperation === null

		this.reportPrepareLocal = this.parent.progressTracker.addPart(isFirst && this.anyNeedsLocalSource() ? 3 : 0)
		this.reportFinalizeLocal = this.parent.progressTracker.addPart(
			this.isFinalStep || conversion.needsLocalTarget ? 3 : 0
		)
		;(this.conversion.preChecks ?? []).forEach(() => {
			this.reportPreChecks.push(this.parent.progressTracker.addPart(1))
		})
		this.reportPrepare = this.parent.progressTracker.addPart(1)
		this.reportProgress = this.parent.progressTracker.addPart(10)
		this.reportFinalize = this.parent.progressTracker.addPart(1)
	}
	public async cancel(): Promise<void> {
		if (this.spawnedProcess) this.spawnedProcess.cancel()
		if (this.subWorkInProgress) await this.subWorkInProgress.cancel()
	}

	public async work(operationPointer: OperationPointer): Promise<OperationPointer> {
		this.logger.debug('Starting work')

		// Step 0: Run pre-checks:
		const preCheckResult = await this.runPreChecks(operationPointer)
		operationPointer = preCheckResult.operationPointer

		if (preCheckResult.runStep) {
			// Step 1: (Maybe) copy source file to local temp folder:

			// (maybe) copy to local folder, then change pointer to match the new location:
			operationPointer = await this.copyToLocalTempFolder(operationPointer, this.conversion)

			// Prepare target pointer:
			const operationTargetPointer = await this.prepareTargetPointer(operationPointer)

			// Step 2: Do the conversion:
			await this.convert(operationPointer, operationTargetPointer, preCheckResult.replaceStrings)
			this.reportProgress(1)
			// (Maybe) Cleanup the source, since the conversion is now done with it:
			await this.cleanupSource(operationPointer)
			this.reportFinalize(1)

			// Move pointer to current target:
			operationPointer = operationTargetPointer
		} else {
			// Skip this conversion step

			this.reportPrepare(1)
			this.reportProgress(1)
			this.reportFinalize(1)

			this.logger.debug('Skipping conversion step due to pre-checks')
		}

		// Step 3: (Maybe) copy target file from local temp folder & cleanup:
		await this.copyFromTempToTarget(operationPointer)
		this.reportFinalizeLocal(1)

		this.logger.debug('Done')

		return operationPointer
	}

	private async runPreChecks(operationPointer: OperationPointer): Promise<{
		/** Resulting OperationPointer, to be used in the conversion step */
		operationPointer: OperationPointer
		/** Whether the conversion step should be run or skipped */
		runStep: boolean
		/** Values that can be used on the args of the conversion step */
		replaceStrings: Record<string, string>
	}> {
		const result: {
			operationPointer: OperationPointer
			runStep: boolean
			replaceStrings: Record<string, string>
		} = {
			operationPointer: operationPointer,
			runStep: true,
			replaceStrings: {},
		}

		if (!this.conversion.preChecks) {
			return result
		}
		for (let i = 0; i < this.conversion.preChecks.length; i++) {
			const preCheck = this.conversion.preChecks[i]

			this.logger.debug(`PreCheck ${i}`)

			// (maybe) copy to local folder, then change pointer to match the new location:
			result.operationPointer = await this.copyToLocalTempFolder(result.operationPointer, preCheck)

			const reportPreCheck = this.reportPreChecks[i]

			// Run PreCheck:
			reportPreCheck(0.1)

			const preCheckResult = await this.executePreCheck(i, result.operationPointer, preCheck)
			reportPreCheck(0.7)

			for (let handleOutputIndex = 0; handleOutputIndex < preCheck.handleOutput.length; handleOutputIndex++) {
				const handle = preCheck.handleOutput[handleOutputIndex]

				const sourceStr =
					handle.source === 'stdout'
						? preCheckResult.stdout
						: handle.source === 'stderr'
						? preCheckResult.stderr
						: ''

				this.logger.silly(handle.source + ' sourceStr ' + sourceStr)

				const regex = new RegExp(handle.regex, handle.regexFlags)
				const matches = sourceStr.match(regex)

				if (matches) {
					this.logger.debug(`PreCheck ${i} match /${handle.regex}/${handle.regexFlags}`)
					// match
					if (handle.effect?.onlyRunStepIfNoMatch) {
						result.runStep = false

						this.logger.debug(
							`Skipping conversion step due to pre-check match condition: /${handle.regex}/${
								handle.regexFlags ?? ''
							}`
						)
					}

					for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
						const match = matches[matchIndex]

						// "{PRECHECK.0.REGEX.1}" (first index is the handleOutput index, second is the capture group index)
						result.replaceStrings[`{PRECHECK.${handleOutputIndex}.REGEX.${matchIndex}}`] = match
					}
				} else {
					this.logger.debug(`PreCheck ${i} no-match /${handle.regex}/${handle.regexFlags}`)
					// no match
					if (handle.effect?.onlyRunStepIfMatch) {
						result.runStep = false
						this.logger.debug(
							`Skipping conversion step due to pre-check no-match condition: /${handle.regex}/${
								handle.regexFlags ?? ''
							}`
						)
					}
				}
			}

			// end
			reportPreCheck(1)
		}

		this.logger.debug(`PreChecks done`)

		return result
	}

	private async executePreCheck(
		stepIndex: number,
		operationPointer: OperationPointer,
		preCheck: Required<ExpectedPackage.ConversionStep>['preChecks'][0]
	): Promise<{
		stdout: string
		stderr: string
	}> {
		const sourcePath = await this.getAccessorFullPath(operationPointer.lookup.handle)
		const args = this.replaceStringsInArgs(preCheck.args, {
			SOURCE: escapeFilePath(sourcePath),
		})

		const executable = this.worker.getExecutable(preCheck.executable)
		if (!executable)
			throw new Error(`The preCheck alias "${preCheck.executable}" is not configured (at step ${stepIndex})`)

		this.logger.debug(`PreCheck step ${stepIndex}: Spawning process: ${executable} ${args.join(' ')}`)

		// Optimization: Just collect data that will be used later:
		let usesStdOut = false
		let usesStdErr = false
		preCheck.handleOutput.forEach((handle) => {
			if (handle.source === 'stderr') usesStdErr = true
			else if (handle.source === 'stdout') usesStdOut = true
		})

		try {
			return await new Promise<{
				stdout: string
				stderr: string
			}>((resolve, reject) => {
				let stdout = ''
				let stderr = ''
				this.spawnedProcess = spawnProcess(
					executable,
					args,
					() => resolve({ stdout, stderr }), // On Done
					(err) => reject(err), // On Error
					noop // on Progress
					// ,this.logger.silly
				)
				if (usesStdOut) {
					this.spawnedProcess.execProcess.stdout.on('data', (data: Buffer) => {
						stdout += data.toString()
					})
				}
				if (usesStdErr) {
					this.spawnedProcess.execProcess.stderr.on('data', (data: Buffer) => {
						stderr += data.toString()
					})
				}
			})
		} finally {
			this.spawnedProcess = undefined
		}
	}

	/**
	 * Copy source file to local temp folder
	 */
	private async copyToLocalTempFolder(
		operationPointer: OperationPointer,
		step: {
			needsLocalSource?: boolean
		}
	): Promise<OperationPointer> {
		if (!step.needsLocalSource || operationPointer.lookup.accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
			// No need to do any copying as we can use the current source directly:
			this.reportPrepareLocal(1)
			return operationPointer
		}

		// Source is not local, so we need to copy the file to a local folder first:
		const localPackageContainer = this.parent.getLocalPackageContainer()

		const sourcePath = await this.getAccessorFullPath(operationPointer.lookup.handle)

		const localLookup = await this.lookupLocalAccessorHandle(
			'Source',
			[localPackageContainer.packageContainer],
			path.basename(sourcePath),
			operationPointer
		)

		if (!localLookup.ready) throw new Error(`Internal Error: localLookup is not ready: ${localLookup.reason.tech}`)

		if (!isLookupFilePackageContainer(localLookup))
			// type guard:
			throw new Error(
				`Internal Error: localLookup is not a file-based PackageContainer (is ${localLookup.accessor?.type})`
			)
		if (this.isItTimeToRunCronJob(localPackageContainer.packageContainer.containerId)) {
			const runResult = await localLookup.handle.runCronJob(localPackageContainer.exp)
			if (!runResult.success)
				this.logger.warn(
					`Running cronjob for local temp PackageContainer ${localPackageContainer.packageContainer.containerId} failed: ${runResult.reason.tech}`
				)
		}

		await this.copyFile(this.parent.lookupSource, localLookup, 'prepare source', this.reportPrepareLocal)
		this.reportPrepareLocal(1)

		// Return pointer to new local source:
		return {
			lookup: localLookup,
			packageContainer: localPackageContainer.packageContainer,
			isTemporary: true,
		} satisfies OperationPointer
	}
	/**
	 * Copy from local temp folder to final target and cleanup, if needed
	 */
	private async copyFromTempToTarget(operationPointer: OperationPointer): Promise<void> {
		if (this.isFinalStep && (operationPointer.isTemporary || operationPointer.isSource)) {
			await this.copyFile(
				operationPointer.lookup,
				this.parent.lookupTarget,
				'final copy to target',
				this.reportFinalizeLocal
			)
		}

		if (this.isFinalStep) {
			// (Maybe) Cleanup the source, since the file has now been copied to the final target:
			await this.cleanupSource(operationPointer)
		}
	}
	/**
	 * Performs a file copy between two file-based PackageContainers
	 * Populates this.subWorkInProgress while running, used for cancellation
	 */
	async copyFile(
		fromPackageContainer: LookupFilePackageContainer<UniversalVersion>,
		toPackageContainer: LookupFilePackageContainer<UniversalVersion>,
		context: string,
		onProgress: ProgressPart
	) {
		const wip = await doFileCopyExpectation(this.parent.worker, this.exp, fromPackageContainer, toPackageContainer)
		if (!wip) throw new Error(`Unable to do file copy, wip is null (${context})`)
		this.subWorkInProgress = wip
		await new Promise((resolve, reject) => {
			wip.on('progress', (_actualVersionHash, progress) => {
				onProgress(progress)
			})
			wip.on('done', resolve)
			wip.on('error', (e: string) => reject(new Error(e)))
		})
		wip.removeAllListeners()
		this.subWorkInProgress = null
	}
	private async prepareTargetPointer(operationPointer: OperationPointer): Promise<OperationPointer> {
		const lookupTarget = this.parent.lookupTarget

		if (this.isFinalStep && lookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
			// Can use the final target directly:
			return {
				lookup: lookupTarget,
				packageContainer: {
					accessors: { [lookupTarget.handle.accessorId]: lookupTarget.accessor },
					containerId: protectString('N/A'),
					label: 'Source',
				},
				isTemporary: false,
			}
		} else {
			// When doing multiple steps, use a temp local folder in between them:

			const localPackageContainer = this.parent.getLocalPackageContainer()

			let fileName: string
			if (!this.isFinalStep && this.conversion.outputFileName !== undefined)
				fileName = this.conversion.outputFileName
			else fileName = path.basename(this.exp.endRequirement.content.filePath)

			const localLookup = await this.lookupLocalAccessorHandle(
				'Intermediate Target',
				[localPackageContainer.packageContainer],
				fileName,
				operationPointer
			)

			if (!localLookup.ready)
				throw new Error(`Internal Error: localLookup is not ready: ${localLookup.reason.tech}`)

			if (!isLookupFilePackageContainer(localLookup))
				// type guard:
				throw new Error(
					`Internal Error: localLookup for final step is not a file-based PackageContainer (is${localLookup.accessor?.type})`
				)

			if (this.isItTimeToRunCronJob(localPackageContainer.packageContainer.containerId)) {
				const runResult = await localLookup.handle.runCronJob(localPackageContainer.exp)
				if (!runResult.success)
					this.logger.warn(
						`Running cronjob for local temp PackageContainer ${localPackageContainer.packageContainer.containerId} failed: ${runResult.reason.tech}`
					)
			}

			return {
				lookup: localLookup,
				packageContainer: localPackageContainer.packageContainer,
				isTemporary: true,
			}
		}
	}
	private replaceStringsInArgs(args: string[], argsReplaceStrings: Record<string, string>): string[] {
		return args.map((arg) => {
			let argOut = arg
			for (const [key, val] of Object.entries<string>(argsReplaceStrings)) {
				argOut = argOut.replace(`{${key}}`, val)
			}
			return argOut
		})
	}
	private async convert(
		operationPointer: OperationPointer,
		operationTargetPointer: OperationPointer,
		argsReplaceStrings: Record<string, string>
	) {
		this.reportPrepare(0.5)

		const sourcePath = await this.getAccessorFullPath(operationPointer.lookup.handle)
		const targetPath = await this.getAccessorFullPath(operationTargetPointer.lookup.handle)
		this.reportPrepare(1)

		argsReplaceStrings.SOURCE = escapeFilePath(sourcePath)
		argsReplaceStrings.TARGET = escapeFilePath(targetPath)

		const executable = this.worker.getExecutable(this.conversion.executable)
		if (!executable) throw new Error(`The conversion alias "${this.conversion.executable}" is not configured`)

		const args = this.replaceStringsInArgs(this.conversion.args, argsReplaceStrings)

		this.logger.debug(`Spawning process: ${executable} ${args.join(' ')}`)

		try {
			await new Promise<void>((resolve, reject) => {
				const recordStdOut: string[] = []
				const recordStdErr: string[] = []
				this.spawnedProcess = spawnProcess(
					executable,
					args,
					() => {
						// On Done
						try {
							if (this.conversion.requiredStdOut?.length) {
								this.requireStringsInProcessOutput(recordStdOut, this.conversion.requiredStdOut)
							}
							if (this.conversion.forbiddenStdOut?.length) {
								this.requireNoStringsInProcessOutput(recordStdOut, this.conversion.forbiddenStdOut)
							}
							if (this.conversion.requiredStdErr?.length) {
								this.requireStringsInProcessOutput(recordStdErr, this.conversion.requiredStdErr)
							}
							if (this.conversion.forbiddenStdErr?.length) {
								this.requireNoStringsInProcessOutput(recordStdErr, this.conversion.forbiddenStdErr)
							}

							resolve()
						} catch (err) {
							reject(err)
						}
					},
					(err) => {
						// On Error
						reject(err)
					},
					(progress: number) => {
						// On Progress
						this.reportProgress(progress)
					}
					// this.logger.silly
				)

				// Only collect stdout if needed:
				if (this.conversion.requiredStdOut?.length || this.conversion.forbiddenStdOut?.length) {
					this.spawnedProcess.execProcess.stdout.on('data', (data: Buffer) => {
						const str = data.toString()
						recordStdOut.push(str)
					})
				}
				// Only collect stderr if needed:
				if (this.conversion.requiredStdErr?.length || this.conversion.forbiddenStdErr?.length) {
					this.spawnedProcess.execProcess.stderr.on('data', (data: Buffer) => {
						const str = data.toString()
						recordStdErr.push(str)
					})
				}
			})
		} finally {
			this.spawnedProcess = undefined
		}
	}
	/**
	 * Remove file from temporary source
	 */
	private async cleanupSource(operationPointer: OperationPointer) {
		if (!operationPointer.isTemporary) {
			// Nothing to do, we only remove temporary files
			return
		}
		try {
			await operationPointer.lookup.handle.removePackage('Cleanup temporary source file')
		} catch (err) {
			this.logger.warn(`Error removing temporary source file: ${stringifyError(err)} (will continue)`)
		}
	}
	private async getAccessorFullPath(handle: GenericAccessorHandle<UniversalVersion>): Promise<string> {
		if (isLocalFolderAccessorHandle(handle)) {
			return handle.fullPath
		} else if (isFileShareAccessorHandle(handle)) {
			await handle.prepareFileAccess()
			return handle.fullPath
		} else if (isHTTPAccessorHandle(handle)) {
			return handle.fullUrl
		} else if (isHTTPProxyAccessorHandle(handle)) {
			return handle.fullUrl
		} else if (isFTPAccessorHandle(handle)) {
			return handle.ftpUrl.url
		} else if (isS3AccessorHandle(handle)) {
			return handle.getFullS3PublicUrl()
		} else {
			throw new Error(`Unsupported AccessHandler`)
		}
	}
	/**
	 * Returns true if enough time has passed to run
	 * @param containerId
	 */
	private isItTimeToRunCronJob(containerId: PackageContainerId): boolean {
		const accessorCache = this.parent.worker.accessorCache

		let cache = accessorCache['__mediaFileConvert'] as { [key: string]: number }
		if (!cache) {
			cache = {}
			accessorCache['__mediaFileConvert'] = cache
		}

		// Run once every 10 minutes, and on first call (ie on worker restart)

		const lastRun = cache[`cronjob-${containerId}`] ?? 0

		if (lastRun < Date.now() - 10 * 60 * 1000) {
			cache[`cronjob-${containerId}`] = Date.now()
			return true
		} else return false
	}

	private async lookupLocalAccessorHandle(
		lookupReason: string,
		/** The PackageContainer to create an AccessorHandle for */
		mainPackageContainers: Expectation.SpecificPackageContainerOnPackage.FileSource[],
		/** File Name (not a full path, just the basename) */
		fileName: string,
		/** The "other" PackageContainer to use for comparison */
		otherOperationPointer: OperationPointer
	) {
		// generate a random fileName to avoid collisions

		return lookupAccessorHandles<UniversalVersion>(
			lookupReason,
			this.parent.worker,
			mainPackageContainers,
			[otherOperationPointer.packageContainer],
			{ expectationId: this.exp.id },
			{
				filePath: `tmp_media_file_convert_${this.parent.workId}_${fileName}`,
			},
			{
				requiredForPlayout: this.exp.workOptions.requiredForPlayout,
				useTemporaryFilePath: false,
			},
			{
				write: true,
				writePackageContainer: true,
			}
		)
	}

	private limitToLastFewLines(lines: string[], maxLines: number): string {
		return lines.slice(-maxLines).join('\n')
	}
	private requireStringsInProcessOutput(recordStdOut: string[], requiredStrings: string[] | undefined) {
		if (!requiredStrings?.length) return

		for (const requiredStr of requiredStrings) {
			if (!recordStdOut.some((line) => line.includes(requiredStr))) {
				throw new Error(
					`Required string "${requiredStr}" not found in stdout. Recorded stdout:\n${this.limitToLastFewLines(
						recordStdOut,
						10
					)}`
				)
			}
		}
	}
	private requireNoStringsInProcessOutput(recordStdOut: string[], forbiddenStrings: string[] | undefined) {
		if (!forbiddenStrings?.length) return

		for (const forbiddenStr of forbiddenStrings) {
			if (recordStdOut.some((line) => line.includes(forbiddenStr))) {
				throw new Error(
					`Forbidden string "${forbiddenStr}" found in stdout. Recorded stdout:\n${this.limitToLastFewLines(
						recordStdOut,
						10
					)}`
				)
			}
		}
	}
}
/**
 * This is a pointer to a file, along with the means to access it.
 */
interface OperationPointer {
	lookup: LookupFilePackageContainer<UniversalVersion>
	packageContainer: PackageContainerOnPackage
	/** True if a temporary storage */
	isTemporary: boolean
	/** True if the original source */
	isSource?: boolean
}
const noop = () => {
	// nothing
}
