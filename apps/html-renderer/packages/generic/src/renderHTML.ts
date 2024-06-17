import { BrowserWindow, app, ipcMain } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { LoggerInstance, escapeFilePath, getFFMpegExecutable, testFFMpeg } from '@sofie-package-manager/api'
import { sleep } from '@sofie-automation/shared-lib/dist/lib/lib'

export interface RenderHTMLOptions {
	logger: LoggerInstance
	/** URL to the web page to render */
	url: string
	/** Width of the window */
	width?: number
	/** Height of the window */
	height?: number
	/** Background color, default to black */
	backgroundColor?: string

	tempFolder?: string
	outputFolder?: string
	/** Scripts to execute */
	scripts: {
		fcn?: (options: { webContents: Electron.WebContents }) => void | Promise<void>
		executeJs?: string
		logInfo?: string
		takeScreenshot?: {
			/** PNG file */
			name: string
		}
		startRecording?: {
			name: string
			full?: boolean
			cropped?: boolean
		}
		wait: number
	}[]
	userAgent?: string
	/** Interactive mode, overrides scripts */
	interactive?: (api: InteractiveAPI) => Promise<void>
}
export async function renderHTML(options: RenderHTMLOptions): Promise<{
	app: Electron.App
	exitCode: number
}> {
	try {
		const testFFMpegResult = await testFFMpeg()
		if (testFFMpegResult) {
			throw new Error(`Cannot access FFMpeg executable: ${testFFMpegResult}`)
		}

		await app.whenReady()

		const width = options.width || 1920
		const height = options.height || 1080
		const tempFolder = options.tempFolder || 'tmp'
		const outputFolder = options.outputFolder || ''
		const logger = options.logger.category('RenderHTML')

		const win = new BrowserWindow({
			show: false,
			alwaysOnTop: true,
			webPreferences: {
				// preload: join(__dirname, 'preload.js'),
				nodeIntegration: false,
			},
			height,
			width,
		})

		win.webContents.setAudioMuted(true)
		if (options.userAgent) win.webContents.setUserAgent(options.userAgent)

		ipcMain.on('console', function (sender, type, args) {
			logger.debug(`Electron: ${sender}, ${type}, ${args}`)
		})
		// win.webContents.on('did-finish-load', (e: unknown) => log('did-finish-load', e))
		// win.webContents.on('did-fail-load', (e: unknown) => log('did-fail-load', e))
		// win.webContents.on('did-fail-provisional-load', (e: unknown) => log('did-fail-provisional-load', e))
		// win.webContents.on('did-frame-finish-load', (e: unknown) => log('did-frame-finish-load', e))
		// win.webContents.on('did-start-loading', (e: unknown) => log('did-start-loading', e))
		// win.webContents.on('did-stop-loading', (e: unknown) => log('did-stop-loading', e))
		// win.webContents.on('dom-ready', (e: unknown) => log('dom-ready', e))
		// win.webContents.on('page-favicon-updated', (e: unknown) => log('page-favicon-updated', e))
		// win.webContents.on('will-navigate', (e: unknown) => log('will-navigate', e))
		// win.webContents.on('plugin-crashed', (e: unknown) => log('plugin-crashed', e))
		// win.webContents.on('destroyed', (e: unknown) => log('destroyed', e))

		let didFinishLoad = false
		let didFailLoad: null | any = null
		win.webContents.on('did-finish-load', () => (didFinishLoad = true))
		win.webContents.on('did-fail-load', (e) => {
			didFailLoad = e
		})

		logger.verbose(`Loading URL: ${options.url}`)
		win.loadURL(options.url).catch((_e) => {
			// ignore, instead rely on 'did-finish-load' and 'did-fail-load' later
		})
		// logger.verbose(`Loading done`)

		win.title = `HTML Renderer ${process.pid}`

		await win.webContents.insertCSS(
			`html,body{ background-color: #${options.backgroundColor ?? '000000'} !important;}`
		)

		let exitCode = 0

		let recording: {
			fileName: string
			tmpFolder: string
			writeFilePromises: Promise<void>[]
			stopped: boolean
		} | null = null
		const api: InteractiveAPI = {
			waitForLoad: async () => {
				console.log('waitForLoad...')
				if (didFinishLoad) return
				if (didFailLoad) throw new Error(`${didFailLoad}`)
				else
					await new Promise<void>((resolve) => {
						win.webContents.once('did-finish-load', () => resolve())
					})

				console.log('waitForLoad done')
			},
			takeScreenshot: async (fileName: string) => {
				if (!fileName) throw new Error(`Invalid filename`)

				const image = await win.webContents.capturePage()
				const filename = path.join(outputFolder, fileName)

				await fs.promises.mkdir(path.dirname(filename), { recursive: true })

				if (fileName.endsWith('.png')) {
					await fs.promises.writeFile(filename, image.toPNG())
				} else if (fileName.endsWith('.jpeg')) {
					await fs.promises.writeFile(filename, image.toJPEG(90))
				} else {
					throw new Error(`Unsupported file format: ${fileName}`)
				}
				return filename
			},
			executeJs: async (js: string) => {
				await win.webContents.executeJavaScript(js)
			},
			startRecording: async (fileName: string, frameListener?: (frameIndex: number) => void) => {
				if (recording?.stopped) {
					await cleanupTemporaryFiles()
					recording = null
				}
				if (recording) throw new Error(`Already recording`)

				const filename = path.join(outputFolder, fileName)
				await fs.promises.mkdir(path.dirname(filename), { recursive: true })

				let i = 0

				const tmpFolder = path.resolve(path.join(tempFolder, `recording${process.pid}`))
				await fs.promises.mkdir(tmpFolder, { recursive: true })

				recording = {
					fileName: `${filename}`,
					tmpFolder,
					writeFilePromises: [],
					stopped: false,
				}

				win.webContents.beginFrameSubscription(false, (image) => {
					if (!recording) throw new Error(`(internal error) received frame, but has no recording`)
					i++
					frameListener?.(i)

					const buffer = image
						.resize({
							width,
							height,
						})
						.toPNG()

					const tmpFile = path.join(tmpFolder, `img${pad(i, 5)}.png`)
					recording.writeFilePromises.push(fs.promises.writeFile(tmpFile, buffer))
				})

				return filename
			},
			stopRecording: async () => {
				if (!recording) throw new Error(`No current recording`)
				if (recording.stopped) throw new Error(`Recording already stopped`)
				recording.stopped = true

				// Wait for all current file writes to finish:
				await Promise.all(recording.writeFilePromises)

				let format: string
				if (recording.fileName.endsWith('.webm')) {
					format = 'webm'
				} else if (recording.fileName.endsWith('.mp4')) {
					format = 'mp4'
				} else if (recording.fileName.endsWith('.mov')) {
					format = 'mov'
				} else {
					throw new Error(`Unsupported file format: ${recording.fileName}`)
				}

				// Convert the pngs to a video:
				await ffmpeg(logger, [
					'-y',
					'-framerate',
					'30',
					'-s',
					`${width}x${height}`,
					'-i',
					`${recording.tmpFolder}/img%05d.png`,
					'-f',
					format, // format: webm
					'-an', // blocks all audio streams
					'-c:v',
					'libvpx-vp9', // encoder for video (use VP9)
					'-auto-alt-ref',
					'1',
					escapeFilePath(recording.fileName),
				])

				return recording.fileName
			},
			cropRecording: async (croppedFilename0: string) => {
				if (!recording) throw new Error(`No recording`)
				if (!recording.stopped) throw new Error(`Recording not stopped yet`)

				const croppedFilename = path.join(outputFolder, croppedFilename0)
				await fs.promises.mkdir(path.dirname(croppedFilename), { recursive: true })

				// Figure out the active bounding box
				const boundingBox = {
					x1: Infinity,
					x2: -Infinity,
					y1: Infinity,
					y2: -Infinity,
				}
				await ffmpeg(
					logger,
					['-i', escapeFilePath(recording.fileName), '-vf', 'bbox=min_val=50', '-f', 'null', '-'],
					{
						onStderr: (data) => {
							// [Parsed_bbox_0 @ 000002b6f5d474c0] n:25 pts:833 pts_time:0.833 x1:205 x2:236 y1:614 y2:650 w:32 h:37 crop=32:37:205:614 drawbox=205:614:32:37
							const m = data.match(
								/Parsed_bbox.*x1:(?<x1>\d+).*x2:(?<x2>\d+).*y1:(?<y1>\d+).*y2:(?<y2>\d+)/
							)
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
					boundingBox.x1 === Infinity ||
					boundingBox.x2 === -Infinity ||
					boundingBox.y1 === Infinity ||
					boundingBox.y2 === -Infinity
				) {
					logger.warn(`Could not determine bounding box`)
					// Just copy the full video
					await fs.promises.copyFile(recording.fileName, croppedFilename)
				} else {
					// Add margins:
					boundingBox.x1 -= 10 + (boundingBox.x1 > width * 0.65 ? 10 : 0)
					boundingBox.x2 += 10 + (boundingBox.x2 < width * 0.65 ? 10 : 0)
					boundingBox.y1 -= 10 + (boundingBox.y1 > height * 0.65 ? 10 : 0)
					boundingBox.y2 += 10 + (boundingBox.y2 < height * 0.65 ? 10 : 0)

					logger.verbose(`Saving cropped recording to ${croppedFilename}`)
					// Generate a cropped video as well:
					await ffmpeg(logger, [
						'-y',
						'-i',
						escapeFilePath(recording.fileName),
						'-filter:v',
						`crop=${boundingBox.x2 - boundingBox.x1}:${boundingBox.y2 - boundingBox.y1}:${boundingBox.x1}:${
							boundingBox.y1
						}`,
						escapeFilePath(croppedFilename),
					])
					logger.verbose(`Saved cropped recording`)
				}
				return croppedFilename
			},
		}
		const cleanupTemporaryFiles = async () => {
			if (recording) {
				await fs.promises.rm(recording.tmpFolder, { recursive: true })
			}
			// Look for old tmp files
			const oldTmpFiles = await fs.promises.readdir(tempFolder)
			for (const oldTmpFile of oldTmpFiles) {
				const oldTmpFileath = path.join(tempFolder, oldTmpFile)
				const stat = await fs.promises.stat(oldTmpFileath)
				if (stat.ctimeMs < Date.now() - 60000) {
					await fs.promises.rm(oldTmpFileath, { recursive: true })
				}
			}
		}
		if (options.interactive) {
			await options.interactive(api)
		} else {
			await api.waitForLoad()

			const waitForScripts: Promise<void>[] = []
			const maxDelay = Math.max(...options.scripts.map((s) => s.wait))
			for (const script of options.scripts) {
				await sleep(script.wait)

				if (script.takeScreenshot) {
					const fileName = await api.takeScreenshot(script.takeScreenshot.name)
					logger.info(`Screenshot: ${fileName}`)
				}
				if (script.fcn) {
					logger.verbose(`Executing fcn`)
					await Promise.resolve(script.fcn({ webContents: win.webContents }))
				}
				if (script.executeJs) {
					logger.verbose(`Executing js: ${script.executeJs}`)
					await api.executeJs(script.executeJs)
				}
				if (script.logInfo) {
					logger.info(script.logInfo)
				}

				if (script.startRecording) {
					let videoFilename = 'N/A'
					const startRecording = async () => {
						await new Promise<void>((resolve, reject) => {
							if (!script.startRecording) return

							const startTime = Date.now()
							const idleFrameTime = Math.max(500, maxDelay)
							let maxFrameIndex = 0
							const endRecording = () => {
								logger.verbose(`Ending recording, got ${maxFrameIndex} frames`)
								win.webContents.endFrameSubscription()
								resolve()
							}

							let endRecordingTimeout = setTimeout(() => {
								endRecording()
							}, idleFrameTime)

							api.startRecording(script.startRecording.name, (i) => {
								// On Frame
								maxFrameIndex = i
								logger.verbose(`Frame ${i}, ${Date.now() - startTime}`)

								// End recording when idle
								clearTimeout(endRecordingTimeout)
								endRecordingTimeout = setTimeout(() => {
									endRecording()
								}, idleFrameTime)
							})
								.then((fileName) => {
									logger.verbose(`Start recording: ${fileName}`)
									videoFilename = fileName
								})
								.catch(reject)
						})

						logger.verbose(`Saving recording to ${videoFilename}`)
						await api.stopRecording()

						try {
							if (script.startRecording?.cropped) {
								const croppedVideoFilename = `${videoFilename}-cropped.webm`

								await api.cropRecording(croppedVideoFilename)

								logger.info(`Cropped video: ${croppedVideoFilename}`)
							}

							if (!script.startRecording?.full) {
								await fs.promises.rm(videoFilename)
							} else {
								logger.info(`Video: ${videoFilename}`)
							}
						} catch (e) {
							logger.error(`Aborting due to an error: ${e}`)
							exitCode = 1
						} finally {
							logger.verbose(`Removing temporary files...`)

							await cleanupTemporaryFiles()

							if (!script.startRecording?.full) {
								await fs.promises.rm(videoFilename)
							}
						}
					}
					waitForScripts.push(startRecording())
				}
			}
		}

		win.close()

		return {
			app: app,
			exitCode,
		}
	} catch (e) {
		// eslint-disable-next-line no-console
		console.error(e)
		return {
			app: app,
			exitCode: 1,
		}
	}
}
function pad(str: string | number, length: number, char = '0') {
	str = str.toString()
	while (str.length < length) {
		str = char + str
	}
	return str
}
async function ffmpeg(
	logger0: LoggerInstance,
	args: string[],
	options?: {
		onStdout?: (data: string) => void
		onStderr?: (data: string) => void
	}
): Promise<void> {
	const logger = logger0.category('FFMpeg')
	await new Promise<void>((resolve, reject) => {
		let logTrace = ''
		const child = spawn(getFFMpegExecutable(), args)

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
				console.error(logTrace)
				reject(new Error(`ffmpeg process exited with code ${code}, args: ${args.join(' ')}`))
			} else resolve()
		})
	})
}
export type InteractiveAPI = {
	waitForLoad: () => Promise<void>
	takeScreenshot: (fileName: string) => Promise<string>
	startRecording: (fileName: string, frameListener?: (frameIndex: number) => void) => Promise<string>
	stopRecording: () => Promise<string>
	cropRecording: (fileName: string) => Promise<string>
	executeJs: (js: string) => Promise<any>
}
