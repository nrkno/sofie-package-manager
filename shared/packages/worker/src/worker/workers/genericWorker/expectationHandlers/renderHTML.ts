import { ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import WebSocket from 'ws'
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
	spawnHtmlRendererExecutable,
	assertNever,
	hash,
	protectString,
	InteractiveStdOut,
	InteractiveReply,
	InteractiveMessage,
	literal,
	htmlTemplateGetSteps,
	htmlTemplateGetFileNamesFromSteps,
	escapeFilePath,
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
import { fetchWithTimeout } from '../../../accessorHandlers/lib/fetch'

/**
 * Copies a file from one of the sources and into the target PackageContainer
 */
export const RenderHTML: ExpectationHandlerGenericWorker = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		if (genericWorker.testHTMLRenderer)
			return {
				support: false,
				knownReason: true,
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
				knownReason: true,
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
				knownReason: true,
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
		const htmlRenderHandler = new HTMLRenderHandler(exp, worker)

		const lookupSource = await lookupSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const mainLookupTarget = await lookupTargets(worker, exp, htmlRenderHandler.mainFileName)
		if (!mainLookupTarget.ready)
			throw new Error(`Can't start working due to target: ${mainLookupTarget.reason.tech}`)

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

			const workInProgress = new WorkInProgress({ workLabel: `Generating preview of "${url}"` }, async () => {
				// On cancel
				htmlRenderHandler.cancel()
			}).do(async () => {
				await lookupSource.handle.getPackageActualVersion()

				await htmlRenderHandler.run({
					workInProgress,
					lookupSource,
					mainLookupTarget,
					url,
				})
			})

			return workInProgress
		} else {
			throw new Error(
				`RenderHTML.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${mainLookupTarget.accessor.type}"`
			)
		}
	},
	removeExpectation: async (
		exp: Expectation.Any,
		reason: string,
		worker: BaseWorker
	): Promise<ReturnTypeRemoveExpectation> => {
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
				knownReason: mainLookupTarget.knownReason,
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
				await lookupTarget.handle.removePackage(reason)
			} catch (err) {
				return {
					removed: false,
					knownReason: false,
					reason: {
						user: `Cannot remove file due to an internal error`,
						tech: `Cannot remove file: ${stringifyError(err)}`,
					},
				}
			}
		}
		// Remove the main one last:
		try {
			await mainLookupTarget.handle.removePackage(reason)
		} catch (err) {
			return {
				removed: false,
				knownReason: false,
				reason: {
					user: `Cannot remove file due to an internal error`,
					tech: `Cannot remove file: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
			// reason: `Removed file "${exp.endRequirement.content.path}" from target`
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
		{ expectationId: exp.id },
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
	filePath: string
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.endRequirement.targets,
		{ expectationId: exp.id },
		{
			filePath,
		},
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}
type Steps = Required<Expectation.RenderHTML['endRequirement']['version']>['steps']
function getSteps(exp: Expectation.RenderHTML) {
	return htmlTemplateGetSteps(exp.endRequirement.version)
}
function getFileNames(steps: Steps) {
	return htmlTemplateGetFileNamesFromSteps(steps)
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

class HTMLRenderHandler {
	public readonly mainFileName: string

	private wasCancelled = false
	private sourceStream: PackageReadStream | undefined = undefined
	private writeStream: PutPackageHandler | undefined = undefined
	private steps: Steps
	private fileNames: string[]
	private timer: { get: () => number }
	private htmlRenderer: HTMLRenderer | undefined

	private outputPath: string
	private executeSteps: { step: Steps[number]; duration: number }[]
	private outputFileNames: string[]

	constructor(public readonly exp: Expectation.RenderHTML, public readonly worker: BaseWorker) {
		this.steps = getSteps(exp)
		const f = getFileNames(this.steps)
		if (!f.mainFileName)
			throw new Error(
				`Can't start working due to no mainFileName (${this.steps.length} steps). This is a configuration issue.`
			)
		this.fileNames = f.fileNames
		this.mainFileName = f.mainFileName

		this.timer = startTimer()

		this.outputPath = path.resolve('./tmpRenderHTML')
		// Prefix the work-in-progress artifacts with a unique identifier
		const filePrefix = hash(`${process.pid}_${Math.random()}`)
		this.executeSteps = this.steps.map((step) => {
			let defaultDuration = 500
			if (
				step.do === 'storeObject' ||
				step.do === 'modifyObject' ||
				step.do === 'injectObject' ||
				step.do === 'executeJs'
			)
				defaultDuration = 10

			const executeStep = {
				step,
				duration: 'duration' in step ? step.duration : defaultDuration, // Used to calculate total duration
			}
			if ('fileName' in executeStep.step) {
				executeStep.step.fileName = `${filePrefix}_${executeStep.step.fileName}`
			}
			return executeStep
		})
		const { fileNames } = getFileNames(this.executeSteps.map((s) => s.step))
		this.outputFileNames = fileNames
	}

	cancel = () => {
		this.wasCancelled = true

		this.htmlRenderer?.cancel()
		// ffProbeProcess?.cancel()
		this.sourceStream?.cancel()
		this.writeStream?.abort()
	}

	async run(options: {
		workInProgress: WorkInProgress
		lookupSource: LookupPackageContainer<UniversalVersion>
		mainLookupTarget: LookupPackageContainer<UniversalVersion>
		url: string
	}) {
		if (!options.lookupSource.ready)
			throw new Error(`Can't start working due to source: ${options.lookupSource.reason.tech}`)
		if (!options.mainLookupTarget.ready)
			throw new Error(`Can't start working due to target: ${options.mainLookupTarget.reason.tech}`)

		const workInProgress = options.workInProgress

		const actualSourceVersion = await options.lookupSource.handle.getPackageActualVersion()
		const actualSourceVersionHash = hashObj(actualSourceVersion)
		const actualSourceUVersion = makeUniversalVersion(actualSourceVersion)

		try {
			// Remote old temp files, if they exist:
			await this.cleanTempFiles()
			workInProgress._reportProgress(actualSourceVersionHash, REPORT_PROGRESS.initialCleanTempFiles)

			// Render HTML file according to the steps:
			this.htmlRenderer = new HTMLRenderer(
				this.worker,
				this.exp,
				options.url,
				workInProgress,
				actualSourceVersionHash,
				this.executeSteps,
				this.outputPath
			)
			await this.htmlRenderer.done

			// Move files to the target:
			await this.moveOutputFilesToTarget({
				workInProgress,
				actualSourceVersionHash,
			})

			// Write metadata
			if (!this.wasCancelled) {
				await options.mainLookupTarget.handle.updateMetadata(actualSourceUVersion)
				workInProgress._reportProgress(actualSourceVersionHash, REPORT_PROGRESS.writeMetadata)
			}

			// Clean temp files:
			await this.cleanTempFiles()
			workInProgress._reportProgress(actualSourceVersionHash, REPORT_PROGRESS.cleanTempFiles)

			// Clean other old files:
			const files = await fs.readdir(this.outputPath)
			await Promise.all(
				files.map(async (file) => {
					const fullPath = path.join(this.outputPath, file)
					const lStat = await fs.lstat(fullPath)
					if (Date.now() - lStat.mtimeMs > 1000 * 3600) {
						await unlinkIfExists(fullPath)
					}
				})
			)

			workInProgress._reportProgress(actualSourceVersionHash, REPORT_PROGRESS.cleanOutputFiles)

			const duration = this.timer.get()
			workInProgress._reportComplete(
				actualSourceVersionHash,
				{
					user: `HTML Rendering completed in ${Math.round(duration / 100) / 10}s`,
					tech: `HTML Rendering completed at ${Date.now()}`,
				},
				undefined
			)
		} catch (e) {
			// cleanup
			this.cancel()

			throw e
		} finally {
			await this.cleanTempFiles()
		}
	}
	async moveOutputFilesToTarget(options: { workInProgress: WorkInProgress; actualSourceVersionHash: string }) {
		// Move all this.outputFileNames files to our target

		for (let i = 0; i < this.outputFileNames.length; i++) {
			if (this.wasCancelled) break
			const tempFileName = this.outputFileNames[i]
			const fileName = this.fileNames[i]
			const localFileSourceHandle = new LocalFolderAccessorHandle({
				worker: this.worker,
				accessorId: protectString<AccessorId>('tmpLocalHTMLRenderer'),
				accessor: {
					type: Accessor.AccessType.LOCAL_FOLDER,
					allowRead: true,
					folderPath: this.outputPath,
					filePath: tempFileName,
				},
				context: { expectationId: this.exp.id },
				content: {},
				workOptions: {},
			})
			const lookupTarget = await lookupTargets(this.worker, this.exp, fileName)
			if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

			const fileOperation = await lookupTarget.handle.prepareForOperation(
				'Copy file, using streams',
				localFileSourceHandle
			)

			options.workInProgress._reportProgress(
				options.actualSourceVersionHash,
				REPORT_PROGRESS.copyFilesToTarget + 0.29 * (i / this.outputFileNames.length)
			)

			const fileSize = (await fs.stat(localFileSourceHandle.fullPath)).size
			const byteCounter = new ByteCounter()
			byteCounter.on('progress', (bytes: number) => {
				if (this.writeStream?.usingCustomProgressEvent) return // ignore this callback, we'll be listening to writeStream.on('progress') instead.

				if (fileSize) {
					const progress = bytes / fileSize
					options.workInProgress._reportProgress(
						options.actualSourceVersionHash,
						REPORT_PROGRESS.copyFilesToTarget + 0.29 * ((i + progress) / this.outputFileNames.length)
					)
				}
			})

			this.sourceStream = await localFileSourceHandle.getPackageReadStream()
			this.writeStream = await lookupTarget.handle.putPackageStream(
				this.sourceStream.readStream.pipe(byteCounter)
			)
			this.writeStream.on('error', (err) => options.workInProgress._reportError(err))

			if (this.writeStream.usingCustomProgressEvent) {
				this.writeStream.on('progress', (progress) => {
					options.workInProgress._reportProgress(
						options.actualSourceVersionHash,
						REPORT_PROGRESS.copyFilesToTarget + 0.29 * ((i + progress) / this.outputFileNames.length)
					)
				})
			}

			await new Promise<void>((resolve, reject) => {
				if (!this.sourceStream) throw new Error(`sourceStream missing`)
				if (!this.writeStream) throw new Error(`writeStream missing`)

				this.sourceStream.readStream.on('error', (err) => reject(err))
				this.writeStream.once('error', (err) => reject(err))
				this.writeStream.once('close', () => resolve())
			})
			this.writeStream.removeAllListeners()
			this.writeStream.removeAllListeners()

			await lookupTarget.handle.finalizePackage(fileOperation)
		}
	}
	private async cleanTempFiles() {
		// Clean temp files:
		await Promise.all(
			this.outputFileNames.map(async (fileName) => unlinkIfExists(path.join(this.outputPath, fileName)))
		)
	}
}

class HTMLRenderer {
	public done: Promise<void>

	// @ts-expect-error is set in constructor
	private resolve: () => void
	// @ts-expect-error is set in constructor
	private reject: (err: unknown) => void

	private totalStepDuration: number
	private htmlRendererProcess: ChildProcessWithoutNullStreams | undefined = undefined
	private ws: WebSocket | undefined = undefined

	private commandStepIndex = 0
	private commandStepDuration = 0
	private waitingForCommand: string | null = null
	private timeoutDoNextCommand: NodeJS.Timeout | undefined = undefined
	private processLastFewLines: string[] = []

	private storedDataObjects: {
		[key: string]: Record<string, any>
	} = {}

	constructor(
		private worker: BaseWorker,
		private exp: Expectation.RenderHTML,
		private url: string,
		private workInProgress: WorkInProgress,
		private actualSourceVersionHash: string,
		private executeSteps: { step: Steps[number]; duration: number }[],
		private outputPath: string
	) {
		this.totalStepDuration = this.executeSteps.reduce((prev, cur) => prev + cur.duration, 0) || 1

		this.done = new Promise<void>((resolve, reject) => {
			this.resolve = resolve
			this.reject = reject

			this.spawnHTMLRendererProcess()
		})
	}
	cancel() {
		// ensure this function doesn't throw, since it is called from various error event handlers
		try {
			this.htmlRendererProcess?.kill()
		} catch (e) {
			// This is probably OK, errors likely means that the process is already dead
		}
		this.htmlRendererProcess = undefined
	}
	private onError(err: unknown) {
		if (err instanceof Error) {
			err.message += `: ${this.processLastFewLines.join('\n')}`
		} else if (typeof err === 'string') {
			err += `: ${this.processLastFewLines.join('\n')}`
		}

		this.reject(err)
		this.cancel()
	}
	private onComplete() {
		this.resolve()
	}

	private spawnHTMLRendererProcess() {
		let width = this.exp.endRequirement.version.renderer?.width
		let height = this.exp.endRequirement.version.renderer?.height
		const scale = this.exp.endRequirement.version.renderer?.scale
		if (width !== undefined && height !== undefined && scale !== undefined) {
			width = Math.floor(width * scale)
			height = Math.floor(height * scale)
		}

		const args = compact<string>([
			`--`,
			`--url=${escapeFilePath(this.url)}`,
			width !== undefined && `--width=${width}`,
			height !== undefined && `--height=${height}`,
			scale !== undefined && `--zoom=${scale}`,
			`--outputPath=${escapeFilePath(this.outputPath)}`,
			`--background=${this.exp.endRequirement.version.renderer?.background ?? 'default'}`,
			`--interactive=true`,
		])
		this.htmlRendererProcess = spawnHtmlRendererExecutable(args, {
			windowsVerbatimArguments: true, // To fix an issue with arguments on Windows
		})

		const onClose = (code: number | null) => {
			if (this.htmlRendererProcess) {
				this.htmlRendererProcess.removeAllListeners()
				this.htmlRendererProcess.stdin.removeAllListeners()
				this.htmlRendererProcess.stdout.removeAllListeners()

				this.htmlRendererProcess = undefined
				if (code === 0) {
					// Do nothing
				} else {
					this.onError(new Error(`HTMLRenderer exit code ${code}`))
				}
			}
		}
		this.htmlRendererProcess.on('close', (code) => onClose(code))
		this.htmlRendererProcess.on('exit', (code) => onClose(code))
		this.htmlRendererProcess.on('error', (err) => {
			this.onError(new Error(`HTMLRenderer error: ${stringifyError(err)}`))
		})

		let waitingForReady = true
		this.htmlRendererProcess.stderr.on('data', (data) => {
			const str = data.toString()
			this.worker.logger.debug(`HTMLRenderer: stderr: ${str}`)
			this.processLastFewLines.push(str)
			if (this.processLastFewLines.length > 10) this.processLastFewLines.shift()
		})
		this.htmlRendererProcess.stdout.on('data', (data) => {
			try {
				const str = data.toString()
				this.worker.logger.debug(`HTMLRenderer: stdout: ${str}`)
				this.processLastFewLines.push(str)
				if (this.processLastFewLines.length > 10) this.processLastFewLines.shift()

				let message: InteractiveStdOut
				try {
					message = JSON.parse(str)
				} catch {
					// ignore parse errors
					return
				}
				if (message.status === 'listening') {
					// This message indicates that the HTML renderer is ready to accept interactive commands on the websocket server
					if (waitingForReady) {
						waitingForReady = false

						this.workInProgress._reportProgress(
							this.actualSourceVersionHash,
							REPORT_PROGRESS.setupWebSocketConnection
						)
						this.setupWebSocketConnection(message.port).catch((e) => this.onError(e))
					} else {
						this.onError(
							new Error(`Unexpected reply from HTMLRenderer: ${message} (not waiting for 'listening')`)
						)
						this.cancel()
					}
				} else {
					assertNever(message.status)
				}
			} catch (e) {
				this.onError(e)
			}
		})
	}

	private async setupWebSocketConnection(port: number) {
		if (this.ws) throw new Error(`WebSocket already set up`)

		const ws = new WebSocket(`ws://127.0.0.1:${port}`)
		this.ws = ws
		ws.once('close', () => {
			ws.removeAllListeners()
			delete this.ws
		})
		ws.on('message', (data) => {
			try {
				const str = data.toString()

				this.worker.logger.debug(`HTMLRenderer: Received reply: ${str}`)

				let message: InteractiveReply | undefined = undefined
				try {
					message = JSON.parse(str)
				} catch {
					// ignore parse errors
				}

				if (!message) {
					// Other output, log and ignore:
					this.worker.logger.debug(`HTMLRenderer: ${str}`)
				} else if (message.error) {
					this.onError(new Error(`Error reply from HTMLRenderer: ${message.error}`))
				} else if (message.reply) {
					if (!this.waitingForCommand) {
						this.onError(
							new Error(`Unexpected reply from HTMLRenderer: ${message.reply} (not waiting for command)`)
						)
					} else if (message.reply === this.waitingForCommand) {
						// This message indicates that the HTML renderer has completed the previous command
						this.waitingForCommand = null

						this.doNextCommand()
					} else {
						this.onError(new Error(`Unexpected reply from HTMLRenderer: ${message.reply}`))
					}
				} else {
					assertNever(message)
					// Other output, log and ignore:
					this.worker.logger.debug(`HTMLRenderer: ${str}`)
				}
			} catch (e) {
				this.onError(e)
			}
		})
		await new Promise<void>((resolve, reject) => {
			ws.once('open', resolve)
			ws.once('error', reject)
		})

		this.worker.logger.debug(`HTMLRenderer: WebSocket connected`)
		this.doNextCommand()
	}

	private doNextCommand() {
		if (!this.ws) throw new Error(`WebSocket not set up`)
		if (this.timeoutDoNextCommand) {
			clearTimeout(this.timeoutDoNextCommand)
			this.timeoutDoNextCommand = undefined
		}
		if (this.waitingForCommand) throw new Error('Already waiting for command')

		const currentStep = this.executeSteps[this.commandStepIndex]
		this.commandStepIndex++

		if (currentStep) {
			const stepStartDuration = this.commandStepDuration
			this.commandStepDuration += currentStep.duration

			const reportStepProgress = (
				/** Progress within the step [0-1] */
				progress: number
			) => {
				this.workInProgress._reportProgress(
					this.actualSourceVersionHash,
					REPORT_PROGRESS.sendCommands +
						0.49 * ((stepStartDuration + progress * currentStep.duration) / this.totalStepDuration)
				)
			}
			reportStepProgress(0)
			if (currentStep.step.do === 'sleep') {
				this.worker.logger.debug(`HTMLRenderer: Sleeping for ${currentStep.step.duration}ms`)

				// While sleeping, continuously report the progress
				let reportTime = 0
				const reportInterval = setInterval(() => {
					reportTime += 500
					reportStepProgress(reportTime / currentStep.duration)
				}, 500)
				setTimeout(() => {
					clearInterval(reportInterval)
					this.doNextCommand()
				}, currentStep.step.duration)
			} else if (currentStep.step.do === 'sendHTTPCommand') {
				this.worker.logger.debug(`HTMLRenderer: Send HTTP command: ${JSON.stringify(currentStep.step)}`)
				const step = currentStep.step

				fetchWithTimeout(step.url, {
					method: step.method,
					headers: step.headers,
					body: step.body,
				})
					.then(() => {
						this.doNextCommand()
					})
					.catch((err) => {
						this.onError(
							new Error(
								`HTMLRenderer: Error when sending "${step.method}" to "${step.url}": ${stringifyError(
									err
								)}`
							)
						)
					})
			} else if (currentStep.step.do === 'storeObject') {
				this.worker.logger.debug(`HTMLRenderer: Store object "${currentStep.step.key}"`)
				try {
					const value =
						typeof currentStep.step.value === 'string'
							? JSON.parse(currentStep.step.value)
							: currentStep.step.value
					this.storedDataObjects[currentStep.step.key] = value
					this.doNextCommand()
				} catch (e) {
					this.onError(
						new Error(
							`HTMLRenderer: Error when parsing value in storeObject for key "${
								currentStep.step.key
							}": ${stringifyError(e)}`
						)
					)
				}
			} else if (currentStep.step.do === 'modifyObject') {
				this.worker.logger.debug(`HTMLRenderer: Modify object "${currentStep.step.key}"`)

				try {
					const obj = this.storedDataObjects[currentStep.step.key]
					if (!obj) throw new Error(`Object "${currentStep.step.key}" not found`)
					modifyObject(obj, currentStep.step.path, currentStep.step.value)
					this.doNextCommand()
				} catch (e) {
					this.onError(
						new Error(
							`HTMLRenderer: Error when modifying object for key "${
								currentStep.step.key
							}": ${stringifyError(e)}`
						)
					)
				}
			} else if (currentStep.step.do === 'injectObject') {
				this.worker.logger.debug(`HTMLRenderer: Inject object "${currentStep.step.key}"`)
				try {
					const obj = this.storedDataObjects[currentStep.step.key]
					if (!obj) throw new Error(`Object "${currentStep.step.key}" not found`)

					const receivingFunction = currentStep.step.receivingFunction ?? 'window.postMessage'

					// Execute javascript in the renderer, to simulate a postMessage event:
					const cmd: InteractiveMessage = {
						do: 'executeJs',
						js: `${receivingFunction}(${JSON.stringify(obj)})`,
					}
					// Send command to the renderer:
					this.setCommandToRenderer(cmd)
				} catch (e) {
					this.onError(
						new Error(
							`HTMLRenderer: Error when injecting object for key "${
								currentStep.step.key
							}": ${stringifyError(e)}`
						)
					)
				}
			} else {
				this.worker.logger.debug(`HTMLRenderer: Send command: ${JSON.stringify(currentStep.step)}`)

				// Send command to the renderer:
				this.setCommandToRenderer(currentStep.step)
			}
		} else {
			// Done, no more commands to send.

			this.workInProgress._reportProgress(this.actualSourceVersionHash, REPORT_PROGRESS.sendCommands + 0.49)

			// Send a close command to the renderer
			this.ws.send(JSON.stringify(literal<InteractiveMessage>({ do: 'close' })))

			// Wait a little bit before completion
			setTimeout(() => {
				this.ws?.close()
				this.onComplete()
			}, 500)
		}
	}
	private setCommandToRenderer(cmd: InteractiveMessage) {
		if (!this.ws) throw new Error(`WebSocket not set up`)

		this.ws.send(JSON.stringify(cmd) + '\n')
		this.waitingForCommand = cmd.do

		this.timeoutDoNextCommand = setTimeout(() => {
			this.onError(new Error(`Timeout waiting for command "${cmd.do}" after ${COMMAND_TIMEOUT} ms`))
		}, COMMAND_TIMEOUT)
	}
}

const COMMAND_TIMEOUT = 10000
const REPORT_PROGRESS = {
	initialCleanTempFiles: 0.05,
	setupWebSocketConnection: 0.08,
	sendCommands: 0.1,
	copyFilesToTarget: 0.6,
	writeMetadata: 0.9,
	cleanTempFiles: 0.95,
	cleanOutputFiles: 0.97,
}

/** Modify an property inside an object */
function modifyObject(obj: Record<string, any> | Record<string, any>[], objPath: string | string[], value: unknown) {
	if (typeof objPath === 'string') objPath = objPath.split('.')

	if (typeof obj === 'object' && obj !== null) {
		if (Array.isArray(obj)) {
			const index = parseInt(objPath[0], 10)
			if (isNaN(index)) throw new Error(`Invalid array key: ${objPath[0]}`)

			if (objPath.length === 1) {
				obj[index] = value
			} else {
				modifyObject(obj[index], objPath.slice(1), value)
			}
		} else {
			const key = objPath[0]
			if (objPath.length === 1) {
				obj[key] = value
			} else {
				modifyObject(obj[key], objPath.slice(1), value)
			}
		}
	} else {
		throw new Error(`Invalid object path: ${objPath.join('.')}`)
	}
}
