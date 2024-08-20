import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn } from 'child_process'
import { InteractiveAPI, RenderHTMLOptions } from './renderHTML'
import { escapeFilePath, getFFMpegExecutable, LoggerInstance } from '@sofie-package-manager/api'

export class BrowserRenderer implements InteractiveAPI {
	private logger: LoggerInstance
	private width: number
	private height: number
	private tempFolder: string
	private outputFolder: string
	private win: BrowserWindow

	private didFinishLoad = false
	private didFailLoad: null | any = null

	/** Current recording */
	private recording: {
		fileName: string
		tmpFolder: string
		writeFilePromises: Promise<void>[]
		stopped: boolean
	} | null = null

	private onStoppedListeners: (() => void)[] = []

	constructor(logger: LoggerInstance, private options: RenderHTMLOptions) {
		this.logger = logger.category('BrowserRenderer')

		this.width = options.width || 1920
		this.height = options.height || 1080
		const zoom = options.zoom || 1
		this.tempFolder = options.tempFolder || 'tmp'
		this.outputFolder = options.outputFolder || ''

		this.win = new BrowserWindow({
			show: false,
			alwaysOnTop: true,
			webPreferences: {
				// preload: join(__dirname, 'preload.js'),
				nodeIntegration: false,
			},
			transparent: true,
			backgroundColor: '#00000000', // This is needed to be able to capture transparent screenshots
			frame: false,
			height: this.height,
			width: this.width,
		})
		this.win.once('ready-to-show', () => {
			// Wait for ready-to-show event to fire,
			// otherwise zetZoomFactor will not work:
			this.win.webContents.setZoomFactor(zoom)
		})
		this.win.webContents.setAudioMuted(true)
		if (options.userAgent) this.win.webContents.setUserAgent(options.userAgent)
	}
	get isRecording(): boolean {
		return this.recording !== null
	}
	async init(): Promise<void> {
		this.win.webContents.on('did-finish-load', () => (this.didFinishLoad = true))
		this.win.webContents.on('did-fail-load', (e) => {
			this.didFailLoad = e
		})

		this.logger.verbose(`Loading URL: ${this.options.url}`)
		this.win.loadURL(this.options.url).catch((_e) => {
			// ignore, instead rely on 'did-finish-load' and 'did-fail-load' later
		})

		// logger.verbose(`Loading done`)

		this.win.title = `HTML Renderer ${process.pid}`

		// Set the background color:
		{
			let backgroundColor = this.options.background ?? 'default'
			if (backgroundColor.match(/^[0-f]+$/)) {
				// "RRGGBB" format
				backgroundColor = '#' + backgroundColor
			}
			if (backgroundColor !== 'default') {
				await this.win.webContents.insertCSS(`html,body{ background: ${backgroundColor} !important;}`)
			}
		}
	}
	close(): void {
		this.win.close()
	}
	async waitForLoad(): Promise<void> {
		if (this.didFinishLoad) return // It had already loaded
		if (this.didFailLoad) throw new Error(`${this.didFailLoad}`)
		else
			await new Promise<void>((resolve) => {
				this.win.webContents.once('did-finish-load', () => resolve())
			})
	}
	async takeScreenshot(fileName: string): Promise<string> {
		if (!fileName) throw new Error(`Invalid filename`)

		const image = await this.win.webContents.capturePage()
		const filename = path.join(this.outputFolder, fileName)

		await fs.promises.mkdir(path.dirname(filename), { recursive: true })

		if (fileName.endsWith('.png')) {
			await fs.promises.writeFile(filename, image.toPNG())
		} else if (fileName.endsWith('.jpeg')) {
			await fs.promises.writeFile(filename, image.toJPEG(90))
		} else {
			throw new Error(`Unsupported file format: ${fileName}`)
		}
		this.logger.verbose(`Screenshot: ${fileName}`)
		return filename
	}
	async executeJs(js: string): Promise<void> {
		this.logger.verbose(`Executing js: ${js}`)
		await this.win.webContents.executeJavaScript(js)
	}
	/** Records a recording */
	async record(
		fileName: string,
		/** If set, will stop the recording if no frames arrive in this time */
		idleFrameTime: number
	): Promise<{
		fileName: string
		/** A promise that will resolve when the recording has stoped */
		stopped: Promise<void>
	}> {
		const startTime = Date.now()
		const stopped = new Promise<void>((resolve) => {
			this.onStoppedListeners.push(() => {
				clearTimeout(endRecordingTimeout)
				resolve()
			})
		})

		const endRecording = () => {
			this.stopRecording().catch((e) => this.logger.error(`Error stopping recording: ${e}`))
		}

		let endRecordingTimeout = setTimeout(() => {
			endRecording()
		}, idleFrameTime)

		const frameListener = (frameIndex: number) => {
			// This callback is called on each frame
			this.logger.debug(`Frame ${frameIndex}, ${Date.now() - startTime}`)

			// End recording when idle:
			clearTimeout(endRecordingTimeout)
			endRecordingTimeout = setTimeout(() => {
				endRecording()
			}, idleFrameTime)
		}

		const recordFileName = await this.startRecording(fileName, frameListener)
		return {
			fileName: recordFileName,
			stopped: stopped,
		}
	}

	/** Start a recording, returns when the recording has started */
	async startRecording(fileName: string, frameListener?: (frameIndex: number) => void): Promise<string> {
		if (this.recording?.stopped) {
			await this.cleanupTemporaryFiles()
			this.recording = null
		}
		if (this.recording) throw new Error(`Already recording`)

		const fullFilename = path.join(this.outputFolder, fileName)
		await fs.promises.mkdir(path.dirname(fullFilename), { recursive: true })

		let i = 0

		const tmpFolder = path.resolve(path.join(this.tempFolder, `recording${process.pid}`))
		await fs.promises.mkdir(tmpFolder, { recursive: true })

		this.recording = {
			fileName: `${fullFilename}`,
			tmpFolder,
			writeFilePromises: [],
			stopped: false,
		}

		this.win.webContents.beginFrameSubscription(false, (image) => {
			if (!this.recording) throw new Error(`(internal error) received frame, but has no recording`)
			i++
			frameListener?.(i)

			const buffer = image
				.resize({
					width: this.width,
					height: this.height,
				})
				.toPNG()

			const tmpFile = path.join(tmpFolder, `img${pad(i, 5)}.png`)
			this.recording.writeFilePromises.push(fs.promises.writeFile(tmpFile, buffer))
		})

		return fullFilename
	}
	async stopRecording(): Promise<string> {
		if (!this.recording) throw new Error(`No current recording`)
		if (this.recording.stopped) throw new Error(`Recording already stopped`)
		this.recording.stopped = true

		this.win.webContents.endFrameSubscription()

		// Wait for all current file writes to finish:
		await Promise.all(this.recording.writeFilePromises)

		let format: string
		if (this.recording.fileName.endsWith('.webm')) {
			format = 'webm'
		} else if (this.recording.fileName.endsWith('.mp4')) {
			format = 'mp4'
		} else if (this.recording.fileName.endsWith('.mov')) {
			format = 'mov'
		} else {
			throw new Error(`Unsupported file format: ${this.recording.fileName}`)
		}

		// Convert the pngs to a video:
		await this.ffmpeg([
			'-hide_banner',
			'-y',
			'-framerate',
			'30',
			'-s',
			`${this.width}x${this.height}`,
			'-i',
			`${this.recording.tmpFolder}/img%05d.png`,
			'-f',
			format, // format: webm
			'-an', // blocks all audio streams
			'-c:v',
			'libvpx-vp9', // encoder for video (use VP9)
			'-auto-alt-ref',
			'1',
			escapeFilePath(this.recording.fileName),
		])

		await this.cleanupTemporaryFiles()

		this.onStoppedListeners.forEach((cb) => cb())

		this.logger.verbose(`Recording: ${this.recording.fileName}`)
		return this.recording.fileName
	}
	async cropRecording(croppedFilename0: string): Promise<string> {
		if (!this.recording) throw new Error(`No recording`)
		if (!this.recording.stopped) throw new Error(`Recording not stopped yet`)

		const croppedFilename = path.join(this.outputFolder, croppedFilename0)
		await fs.promises.mkdir(path.dirname(croppedFilename), { recursive: true })

		// Figure out the active bounding box
		const boundingBox = {
			x1: Infinity,
			x2: -Infinity,
			y1: Infinity,
			y2: -Infinity,
		}
		await this.ffmpeg(
			[
				'-hide_banner',
				'-i',
				escapeFilePath(this.recording.fileName),
				'-vf',
				'bbox=min_val=50',
				'-f',
				'null',
				'-',
			],
			{
				onStderr: (data) => {
					// [Parsed_bbox_0 @ 000002b6f5d474c0] n:25 pts:833 pts_time:0.833 x1:205 x2:236 y1:614 y2:650 w:32 h:37 crop=32:37:205:614 drawbox=205:614:32:37
					const m = data.match(/Parsed_bbox.*x1:(?<x1>\d+).*x2:(?<x2>\d+).*y1:(?<y1>\d+).*y2:(?<y2>\d+)/)
					if (m && m.groups) {
						boundingBox.x1 = Math.min(boundingBox.x1, parseInt(m.groups.x1, 10))
						boundingBox.x2 = Math.max(boundingBox.x2, parseInt(m.groups.x2, 10))
						boundingBox.y1 = Math.min(boundingBox.y1, parseInt(m.groups.y1, 10))
						boundingBox.y2 = Math.max(boundingBox.y2, parseInt(m.groups.y2, 10))
					}
				},
			}
		)

		if (
			!Number.isFinite(boundingBox.x1) ||
			!Number.isFinite(boundingBox.x2) ||
			!Number.isFinite(boundingBox.y1) ||
			!Number.isFinite(boundingBox.y2)
		) {
			this.logger.warn(`Could not determine bounding box`)
			// Just copy the full video
			await fs.promises.copyFile(this.recording.fileName, croppedFilename)
		} else {
			// Add margins:, to account for things like drop shadows
			boundingBox.x1 -= 10
			boundingBox.x2 += 10
			boundingBox.y1 -= 10
			boundingBox.y2 += 10

			this.logger.verbose(`Saving cropped recording to ${croppedFilename}`)
			// Generate a cropped video as well:
			await this.ffmpeg([
				'-hide_banner',
				'-y',
				'-i',
				escapeFilePath(this.recording.fileName),
				'-filter:v',
				`crop=${boundingBox.x2 - boundingBox.x1}:${boundingBox.y2 - boundingBox.y1}:${boundingBox.x1}:${
					boundingBox.y1
				}`,
				escapeFilePath(croppedFilename),
			])
		}
		this.logger.verbose(`Cropped Recording: ${croppedFilename}`)
		return croppedFilename
	}

	private async cleanupTemporaryFiles() {
		try {
			if (this.recording) {
				await fs.promises.rm(this.recording.tmpFolder, { recursive: true })
			}
			// Look for old tmp files
			const oldTmpFiles = await fs.promises.readdir(this.tempFolder)
			for (const oldTmpFile of oldTmpFiles) {
				const oldTmpFileath = path.join(this.tempFolder, oldTmpFile)
				const stat = await fs.promises.stat(oldTmpFileath)
				if (stat.ctimeMs < Date.now() - 60000) {
					await fs.promises.rm(oldTmpFileath, { recursive: true })
				}
			}
		} catch (e) {
			// Just log and continue...
			this.logger.error(e)
		}
	}
	async ffmpeg(
		args: string[],
		options?: {
			onStdout?: (data: string) => void
			onStderr?: (data: string) => void
		}
	): Promise<void> {
		const logger = this.logger.category('FFMpeg')
		await new Promise<void>((resolve, reject) => {
			let logTrace = ''
			const child = spawn(getFFMpegExecutable(), args, {
				windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
			})

			child.stdout.on('data', (data) => {
				options?.onStdout?.(data.toString())
				logTrace += data.toString() + '\n'
				logger.debug(data.toString())
			})
			child.stderr.on('data', (data) => {
				options?.onStderr?.(data.toString())
				logTrace += data.toString() + '\n'
				logger.debug(data.toString())
			})
			child.on('close', (code) => {
				if (code !== 0) {
					// eslint-disable-next-line no-console
					logger.error(logTrace)
					reject(new Error(`ffmpeg process exited with code ${code}, args: ${args.join(' ')}`))
				} else resolve()
			})
		})
	}
}
function pad(str: string | number, length: number, char = '0') {
	str = str.toString()
	while (str.length < length) {
		str = char + str
	}
	return str
}
