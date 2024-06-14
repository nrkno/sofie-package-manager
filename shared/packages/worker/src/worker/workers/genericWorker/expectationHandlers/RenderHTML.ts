import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { BaseWorker } from '../../../worker'
import { UniversalVersion, getStandardCost, makeUniversalVersion } from '../lib/lib'
import {
	Accessor,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	stringifyError,
	AccessorId,
	startTimer,
	hashObj,
	getHtmlRendererExecutable,
	assertNever,
	hash,
	protectString,
} from '@sofie-package-manager/api'

import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { isFileFulfilled, isFileReadyToStartWorkingOn } from './lib/file'
import { ExpectationHandlerGenericWorker, GenericWorker } from '../genericWorker'
import {
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { LocalFolderAccessorHandle } from '../../../accessorHandlers/localFolder'
import { PackageReadStream, PutPackageHandler } from '../../../accessorHandlers/genericHandle'
import { ByteCounter } from '../../../lib/streamByteCounter'

/**
 * Copies a file from one of the sources and into the target PackageContainer
 */
export const RenderHTML: ExpectationHandlerGenericWorker = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		if (genericWorker.testHTMLRenderer)
			return {
				support: false,
				reason: {
					user: 'There is an issue with the Worker (HTMLRenderer)',
					tech: `Cannot access HTMLRenderer executable: ${genericWorker.testHTMLRenderer}`,
				},
			}
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isHTMLRender(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isHTMLRender(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const steps = getSteps(exp)
		const { mainFileName } = getFileNames(steps)
		if (!mainFileName)
			return {
				ready: false,
				reason: {
					user: 'No output (this is a configuration issue)',
					tech: `No output filename (${steps.length} steps)`,
				},
			}

		const lookupSource = await lookupSources(worker, exp)
		const lookupTarget = await lookupTargets(worker, exp, mainFileName)

		return isFileReadyToStartWorkingOn(worker, lookupSource, lookupTarget)
	},
	isExpectationFulfilled: async (
		exp: Expectation.Any,
		_wasFulfilled: boolean,
		worker: BaseWorker
	): Promise<ReturnTypeIsExpectationFulfilled> => {
		if (!isHTMLRender(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const steps = getSteps(exp)
		const { fileNames, mainFileName } = getFileNames(steps)
		if (!mainFileName)
			return {
				fulfilled: false,
				reason: {
					user: 'No output (this is a configuration issue)',
					tech: `No output filename (${steps.length} steps)`,
				},
			}
		const lookupSource = await lookupSources(worker, exp)

		// First, check metadata
		const mainLookupTarget = await lookupTargets(worker, exp, mainFileName)

		// Do a full check on the main file:
		const mainFulfilledStatus = await isFileFulfilled(worker, lookupSource, mainLookupTarget)
		if (!mainFulfilledStatus.fulfilled) return mainFulfilledStatus

		// Go through the other files, just check that they exist:
		for (const fileName of fileNames) {
			if (fileName === mainFileName) continue // already checked

			const lookupTarget = await lookupTargets(worker, exp, fileName)

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
		}
		return {
			fulfilled: true,
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<IWorkInProgress> => {
		if (!isHTMLRender(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Render the HTML file

		/*
		 * What this one does is:
		 * 1. Spin up the HtmlRenderer executable and send it commands
		      to render the HTML file, take screenshots, record video etc,
		      according to the steps defined in the expectation.
		   2. The output from HtmlRenderer executable are files in a temporary folder.
		   3. Copy the files from the temporary folder to the target PackageContainer.
		   4. Clean up the temporary files.
		*/

		const steps = getSteps(exp)
		const { fileNames, mainFileName } = getFileNames(steps)
		if (!mainFileName)
			throw new Error(
				`Can't start working due to no mainFileName (${steps.length} steps). This is a configuration issue.`
			)

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const mainLookupTarget = await lookupTargets(worker, exp, mainFileName)
		if (!mainLookupTarget.ready)
			throw new Error(`Can't start working due to target: ${mainLookupTarget.reason.tech}`)

		const timer = startTimer()
		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)
		const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

		const sourceHandle = lookupSource.handle
		const mainTargetHandle = mainLookupTarget.handle

		if (
			(lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				lookupSource.accessor.type === Accessor.AccessType.FILE_SHARE ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP ||
				lookupSource.accessor.type === Accessor.AccessType.HTTP_PROXY) &&
			(mainLookupTarget.accessor.type === Accessor.AccessType.LOCAL_FOLDER ||
				mainLookupTarget.accessor.type === Accessor.AccessType.FILE_SHARE ||
				mainLookupTarget.accessor.type === Accessor.AccessType.HTTP_PROXY)
		) {
			if (
				!isLocalFolderAccessorHandle(sourceHandle) &&
				!isFileShareAccessorHandle(sourceHandle) &&
				!isHTTPAccessorHandle(sourceHandle) &&
				!isHTTPProxyAccessorHandle(sourceHandle)
			)
				throw new Error(`Source AccessHandler type is wrong`)
			if (
				!isLocalFolderAccessorHandle(mainTargetHandle) &&
				!isFileShareAccessorHandle(mainTargetHandle) &&
				!isHTTPProxyAccessorHandle(mainTargetHandle)
			)
				throw new Error(`Target AccessHandler type is wrong`)

			let url: string
			if (isLocalFolderAccessorHandle(sourceHandle)) {
				url = `file://${sourceHandle.fullPath}`
			} else if (isFileShareAccessorHandle(sourceHandle)) {
				url = `file://${sourceHandle.fullPath}`
			} else if (isHTTPAccessorHandle(sourceHandle)) {
				url = `${sourceHandle.fullUrl}`
			} else if (isHTTPProxyAccessorHandle(sourceHandle)) {
				url = `${sourceHandle.fullUrl}`
			} else {
				assertNever(sourceHandle)
				throw new Error(`Unsupported Source AccessHandler`)
			}

			let htmlRendererProcess: ChildProcessWithoutNullStreams | undefined
			const killProcess = () => {
				// ensure this function doesn't throw, since it is called from various error event handlers
				try {
					htmlRendererProcess?.kill()
				} catch (e) {
					// This is probably OK, errors likely means that the process is already dead
				}
				htmlRendererProcess = undefined
			}

			let wasCancelled = false
			let sourceStream: PackageReadStream | undefined = undefined
			let writeStream: PutPackageHandler | undefined = undefined
			const workInProgress = new WorkInProgress({ workLabel: 'Generating preview' }, async () => {
				// On cancel
				wasCancelled = true
				killProcess()
				// ffProbeProcess?.cancel()
				sourceStream?.cancel()
				writeStream?.abort()
			}).do(async () => {
				const outputPath = path.resolve('./tmpRenderHTML')

				// Prefix the work-in-progress artifacts with a unique identifier
				const filePrefix = hash(`${process.pid}_${Math.random()}`)
				const tempSteps = steps.map((step) => {
					const tempStep = {
						...step,
						duration: 500, // Used to calculate total duration
					}
					if ('fileName' in tempStep) {
						tempStep.fileName = `${filePrefix}_${tempStep.fileName}`
					}
					if ('duration' in step) {
						tempStep.duration = step.duration
					}
					return tempStep
				})
				const totalTempStepDuration = tempSteps.reduce((prev, cur) => prev + cur.duration, 0) || 1
				const { fileNames: tempFileNames } = getFileNames(tempSteps)
				// Remote old files, if they exist:
				await Promise.all(
					tempFileNames.map(async (fileName) => unlinkIfExists(path.join(outputPath, fileName)))
				)
				workInProgress._reportProgress(actualSourceVersionHash, 0.1)

				// Render HTML file according to the steps:
				await new Promise<void>((resolve, reject) => {
					htmlRendererProcess = spawn(
						getHtmlRendererExecutable(),
						compact<string>([
							`--url=${url}`,
							exp.endRequirement.version.renderer?.width !== undefined &&
								`--width=${exp.endRequirement.version.renderer?.width}]`,
							exp.endRequirement.version.renderer?.height !== undefined &&
								`--height=${exp.endRequirement.version.renderer?.height}]`,
							`--outputPath=${outputPath}`,
							`--interactive=true`,
						]),
						{
							windowsVerbatimArguments: true, // To fix an issue with arguments on Windows
						}
					)
					const lastFewLines: string[] = []
					const onClose = (code: number | null) => {
						if (htmlRendererProcess) {
							// log?.('HTMLRenderer: close ' + code)
							htmlRendererProcess = undefined
							if (code === 0) {
								// Do nothing
							} else {
								reject(new Error(`HTMLRenderer exit code ${code}: ${lastFewLines.join('\n')}`))
							}
						}
					}
					htmlRendererProcess.on('close', (code) => {
						onClose(code)
					})
					htmlRendererProcess.on('exit', (code) => {
						onClose(code)
					})
					htmlRendererProcess.on('error', (err) => {
						reject(new Error(`spawnHTMLRenderer error: ${stringifyError(err)}`))
					})

					let stepIndex = 0
					let waitingForReady = true
					let waitingForCommand: string | null = null
					let stepDuration = 0
					const sendNextCommand = () => {
						const cmd = tempSteps[stepIndex]
						if (cmd) {
							htmlRendererProcess?.stdin.write(JSON.stringify(cmd) + '\n')
							waitingForCommand = cmd.do
							stepIndex++

							stepDuration += cmd.duration

							workInProgress._reportProgress(
								actualSourceVersionHash,
								0.1 + 0.49 * (stepDuration / totalTempStepDuration)
							)
						} else {
							// Done, no more commands to send
							killProcess()
							resolve()
						}
					}

					htmlRendererProcess.stderr.on('data', (data) => {
						const str = data.toString()
						lastFewLines.push(str)
						if (lastFewLines.length > 10) lastFewLines.shift()
					})
					htmlRendererProcess.stdout.on('data', (data) => {
						const str = data.toString()

						lastFewLines.push(str)
						if (lastFewLines.length > 10) lastFewLines.shift()

						let message: Record<string, any>
						try {
							message = JSON.parse(str)
						} catch {
							// ignore parse errors
							return
						}
						if (message.status === 'ready') {
							// This message indicates that the HTML renderer is ready to accept interactive commands
							if (waitingForReady) {
								waitingForReady = false
								sendNextCommand()
							} else {
								reject(
									new Error(`Unexpected reply from HTMLRenderer: ${message} (not waiting for ready)`)
								)
								killProcess()
							}
						} else if (message.reply) {
							if (!waitingForCommand) {
								reject(
									new Error(
										`Unexpected reply from HTMLRenderer: ${message.reply} (not waiting for command)`
									)
								)
								killProcess()
							} else if (message.reply === waitingForCommand) {
								// This message indicates that the HTML renderer has completed the previous command
								waitingForCommand = null
								sendNextCommand()
							} else {
								reject(
									new Error(
										`Unexpected reply from HTMLRenderer: ${message.reply} (not waiting for command)`
									)
								)
								killProcess()
							}
						} else {
							// Other output, log and ignore:
							worker.logger.silly(`HTMLRenderer: ${str}`)
						}
					})
				})

				// Move files to the target:

				for (let i = 0; i < tempFileNames.length; i++) {
					if (wasCancelled) break
					const tempFileName = tempFileNames[i]
					const fileName = fileNames[i]
					const localFileSourceHandle = new LocalFolderAccessorHandle(
						worker,
						protectString<AccessorId>('tmpLocalHTMLRenderer'),
						{
							type: Accessor.AccessType.LOCAL_FOLDER,
							allowRead: true,
							folderPath: outputPath,
							filePath: tempFileName,
						},
						{},
						{}
					)
					const lookupTarget = await lookupTargets(worker, exp, fileName)
					if (!lookupTarget.ready)
						throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

					const fileOperation = await lookupTarget.handle.prepareForOperation(
						'Copy file, using streams',
						lookupSource.handle
					)

					workInProgress._reportProgress(actualSourceVersionHash, 0.6 + 0.3 * (i / tempFileNames.length))

					const fileSize = (await fs.stat(localFileSourceHandle.fullPath)).size
					const byteCounter = new ByteCounter()
					byteCounter.on('progress', (bytes: number) => {
						if (writeStream?.usingCustomProgressEvent) return // ignore this callback, we'll be listening to writeStream.on('progress') instead.

						if (fileSize) {
							const progress = bytes / fileSize
							workInProgress._reportProgress(
								actualSourceVersionHash,
								0.6 + 0.3 * ((i + progress) / tempFileNames.length)
							)
						}
					})

					sourceStream = await localFileSourceHandle.getPackageReadStream()
					writeStream = await lookupTarget.handle.putPackageStream(sourceStream.readStream.pipe(byteCounter))

					if (writeStream.usingCustomProgressEvent) {
						writeStream.on('progress', (progress) => {
							workInProgress._reportProgress(
								actualSourceVersionHash,
								0.6 + 0.3 * ((i + progress) / tempFileNames.length)
							)
						})
					}

					await new Promise<void>((resolve, reject) => {
						if (!sourceStream) throw new Error(`sourceStream missing`)
						if (!writeStream) throw new Error(`writeStream missing`)

						sourceStream.readStream.on('error', (err) => {
							reject(err)
						})
						writeStream.on('error', (err) => {
							reject(err)
						})
						writeStream.once('close', () => {
							resolve()
						})
					})
					writeStream.removeAllListeners()
					writeStream.removeAllListeners()

					await lookupTarget.handle.finalizePackage(fileOperation)
				}

				// Write metadata
				if (!wasCancelled) {
					await mainTargetHandle.updateMetadata(actualSourceUVersion)
					workInProgress._reportProgress(actualSourceVersionHash, 0.91)
				}

				// Clean temp files:
				await Promise.all(
					tempFileNames.map(async (fileName) => unlinkIfExists(path.join(outputPath, fileName)))
				)
				workInProgress._reportProgress(actualSourceVersionHash, 0.95)

				// Clean other old files:
				const files = await fs.readdir(outputPath)
				await Promise.all(
					files.map(async (file) => {
						const fullPath = path.join(outputPath, file)
						const lStat = await fs.lstat(fullPath)
						if (Date.now() - lStat.mtimeMs > 1000 * 3600) {
							await unlinkIfExists(fullPath)
						}
					})
				)
				// workInProgress._reportProgress(actualSourceVersionHash, 0.99)

				const duration = timer.get()
				workInProgress._reportComplete(
					actualSourceVersionHash,
					{
						user: `HTML Rendering completed in ${Math.round(duration / 100) / 10}s`,
						tech: `HTML Rendering completed at ${Date.now()}`,
					},
					undefined
				)
			})

			return workInProgress
		} else {
			throw new Error(
				`RenderHTML.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${mainLookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: BaseWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isHTMLRender(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the files on the location

		const steps = getSteps(exp)
		const { fileNames, mainFileName } = getFileNames(steps)
		if (!mainFileName)
			throw new Error(
				`Can't start working due to no mainFileName (${steps.length} steps). This is a configuration issue.`
			)

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const mainLookupTarget = await lookupTargets(worker, exp, mainFileName)
		if (!mainLookupTarget.ready) {
			return {
				removed: false,
				reason: {
					user: `Can't access target, due to: ${mainLookupTarget.reason.user}`,
					tech: `No access to target: ${mainLookupTarget.reason.tech}`,
				},
			}
		}

		for (const fileName of fileNames) {
			if (fileName === mainFileName) continue // remove this last
			const lookupTarget = await lookupTargets(worker, exp, fileName)
			if (!lookupTarget.ready) {
				throw new Error(`Cannot remove files due to target: ${lookupTarget.reason.tech}`)
			}

			try {
				await lookupTarget.handle.removePackage('expectation removed')
			} catch (err) {
				return {
					removed: false,
					reason: {
						user: `Cannot remove file due to an internal error`,
						tech: `Cannot remove file: ${stringifyError(err)}`,
					},
				}
			}
		}
		// Remove the main one last:
		try {
			await mainLookupTarget.handle.removePackage('expectation removed')
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
function isHTMLRender(exp: Expectation.Any): exp is Expectation.RenderHTML {
	return exp.type === Expectation.Type.RENDER_HTML
}

async function lookupSources(
	worker: BaseWorker,
	exp: Expectation.RenderHTML
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.startRequirement.sources,
		exp.startRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.startRequirement.version,
		}
	)
}
async function lookupTargets(
	worker: BaseWorker,
	exp: Expectation.RenderHTML,
	fileName: string
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.endRequirement.targets,
		{
			fileName,
		},
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}
type Steps = Required<Expectation.RenderHTML['endRequirement']['version']>['steps']
function getSteps(exp: Expectation.RenderHTML): Steps {
	if (exp.endRequirement.version.casparCG) {
		const casparData = exp.endRequirement.version.casparCG.data
		const casparDataJSON = typeof casparData === 'string' ? casparData : JSON.stringify(casparData)
		return [
			{ do: 'waitForLoad' },
			{ do: 'takeScreenshot', fileName: 'idle.png' },
			{ do: 'startRecording', fileName: 'preview.webm' },
			{ do: 'executeJs', js: `update(${casparDataJSON})` },
			{ do: 'executeJs', js: `play()` },
			{ do: 'sleep', duration: 1000 },
			{ do: 'takeScreenshot', fileName: 'play.png' },
			{ do: 'executeJs', js: `stop()` },
			{ do: 'sleep', duration: 1000 },
			{ do: 'takeScreenshot', fileName: 'stop.png' },
			{ do: 'stopRecording' },
		]
	}
	return exp.endRequirement.version.steps || []
}
function getFileNames(steps: Steps) {
	const fileNames: string[] = []
	let mainFileName: string | undefined = undefined
	for (const step of steps) {
		if (step.do === 'takeScreenshot') {
			fileNames.push(step.fileName)
			if (!mainFileName) mainFileName = step.fileName
		} else if (step.do === 'startRecording') {
			fileNames.push(step.fileName)
			mainFileName = step.fileName
		} else if (step.do === 'cropRecording') {
			fileNames.push(step.fileName)
		}
	}
	return { fileNames, mainFileName }
}
function compact<T>(array: (T | undefined | null | false)[]): T[] {
	return array.filter(Boolean) as T[]
}
async function unlinkIfExists(path: string) {
	try {
		await fs.unlink(path)
	} catch {
		// ignore errors
	}
}
