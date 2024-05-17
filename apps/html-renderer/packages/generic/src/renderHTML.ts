import { BrowserWindow, app, ipcMain } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { LoggerInstance, getFFMpegExecutable, testFFMpeg } from '@sofie-package-manager/api'
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

		logger.verbose(`Loading URL: ${options.url}`)
		await win.loadURL(options.url)
		logger.verbose(`Loading done`)

		win.title = `HTML Renderer ${process.pid}`

		await win.webContents.insertCSS(
			`html,body{ background-color: #${options.backgroundColor ?? '000000'} !important;}`
		)

		let exitCode = 0

		const waitForScripts: Promise<void>[] = []
		const maxDelay = Math.max(...options.scripts.map((s) => s.wait))
		for (const script of options.scripts) {
			await sleep(script.wait)

			if (script.takeScreenshot) {
				const image = await win.webContents.capturePage()
				const filename = path.join(outputFolder, script.takeScreenshot.name)
				await fs.promises.writeFile(filename, image.toPNG())
				logger.info(`Screenshot: ${filename}`)
			}

			if (script.fcn) {
				logger.verbose(`Executing fcn`)
				await Promise.resolve(script.fcn({ webContents: win.webContents }))
			}
			if (script.executeJs) {
				logger.verbose(`Executing js: ${script.executeJs}`)
				await win.webContents.executeJavaScript(script.executeJs)
			}
			if (script.logInfo) {
				logger.info(script.logInfo)
			}

			if (script.startRecording) {
				const startRecording = async () => {
					if (!script.startRecording) return
					const filename = path.join(outputFolder, script.startRecording.name)
					logger.verbose(`Start recording: ${filename}`)
					let i = 0

					const tmpFolder = path.resolve(path.join(tempFolder, `recording${process.pid}`))
					await fs.promises.mkdir(tmpFolder, {
						recursive: true,
					})
					const videoFilename = `${filename}.webm`
					const croppedVideoFilename = `${filename}-cropped.webm`
					const writeFilePromises: Promise<void>[] = []
					const idleFrameTime = Math.max(500, maxDelay)
					try {
						await new Promise<void>((resolve) => {
							const endRecording = () => {
								logger.verbose(`Ending recording, got ${i} frames`)
								win.webContents.endFrameSubscription()
								resolve()
							}

							let endRecordingTimeout = setTimeout(() => {
								endRecording()
							}, idleFrameTime)

							const startTime = Date.now()
							win.webContents.beginFrameSubscription(false, (image) => {
								i++
								logger.verbose(`Frame ${i}, ${Date.now() - startTime}`)

								const buffer = image
									.resize({
										width,
										height,
									})
									.toPNG()

								const tmpFile = path.join(tmpFolder, `img${pad(i, 5)}.png`)
								writeFilePromises.push(fs.promises.writeFile(tmpFile, buffer))

								// End recording when idle
								clearTimeout(endRecordingTimeout)
								endRecordingTimeout = setTimeout(() => {
									endRecording()
								}, idleFrameTime)
							})
						})

						await Promise.all(writeFilePromises)

						logger.verbose(`Saving recording to ${videoFilename}`)
						// Convert the pngs to a video:
						await ffmpeg(logger, [
							'-y',
							'-framerate',
							'30',
							'-s',
							`${width}x${height}`,
							'-i',
							`${tmpFolder}/img%05d.png`,
							'-f',
							'webm', // format: webm
							'-an', // blocks all audio streams
							'-c:v',
							'libvpx-vp9', // encoder for video (use VP9)
							'-auto-alt-ref',
							'1',
							videoFilename,
						])

						if (script.startRecording.cropped) {
							// Figure out the active bounding box
							const boundingBox = {
								x1: Infinity,
								x2: -Infinity,
								y1: Infinity,
								y2: -Infinity,
							}
							await ffmpeg(logger, ['-i', videoFilename, '-vf', 'bbox=min_val=50', '-f', 'null', '-'], {
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
							})

							if (
								boundingBox.x1 === Infinity ||
								boundingBox.x2 === -Infinity ||
								boundingBox.y1 === Infinity ||
								boundingBox.y2 === -Infinity
							) {
								logger.warn(`Could not determine bounding box`)
								// Just copy the full video
								await fs.promises.copyFile(videoFilename, croppedVideoFilename)
							} else {
								// Add margins:
								boundingBox.x1 -= 10 + (boundingBox.x1 > width * 0.65 ? 10 : 0)
								boundingBox.x2 += 10 + (boundingBox.x2 < width * 0.65 ? 10 : 0)
								boundingBox.y1 -= 10 + (boundingBox.y1 > height * 0.65 ? 10 : 0)
								boundingBox.y2 += 10 + (boundingBox.y2 < height * 0.65 ? 10 : 0)

								logger.verbose(`Saving cropped recording to ${croppedVideoFilename}`)
								// Generate a cropped video as well:
								await ffmpeg(logger, [
									'-y',
									'-i',
									videoFilename,
									'-filter:v',
									`crop=${boundingBox.x2 - boundingBox.x1}:${boundingBox.y2 - boundingBox.y1}:${
										boundingBox.x1
									}:${boundingBox.y1}`,
									croppedVideoFilename,
								])
							}
							logger.info(`Cropped video: ${croppedVideoFilename}`)
						}

						if (!script.startRecording.full) {
							await fs.promises.rm(videoFilename)
						} else {
							logger.info(`Video: ${videoFilename}`)
						}
					} catch (e) {
						logger.error(`Aborting due to an error: ${e}`)
						exitCode = 1
					} finally {
						logger.verbose(`Removing temporary files...`)
						await fs.promises.rm(tmpFolder, { recursive: true })

						if (!script.startRecording.full) {
							await fs.promises.rm(videoFilename)
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
				}
				waitForScripts.push(startRecording())
			}
		}

		await Promise.all(waitForScripts)

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
