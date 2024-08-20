import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import { LoggerInstance, testFFMpeg } from '@sofie-package-manager/api'
import { sleep } from '@sofie-automation/shared-lib/dist/lib/lib'
import { BrowserRenderer } from './BrowserRenderer'

export interface RenderHTMLOptions {
	logger: LoggerInstance
	/** URL to the web page to render */
	url: string
	/** Width of the window */
	width?: number
	/** Height of the window */
	height?: number
	/** Zoom factor */
	zoom?: number
	/** Background color, default to "default" */
	background?: string

	tempFolder?: string
	outputFolder?: string
	/** Scripts to execute */
	scripts: {
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

		const logger = options.logger.category('RenderHTML')
		ipcMain.on('console', function (sender, type, args) {
			logger.debug(`Electron: ${sender}, ${type}, ${args}`)
		})

		const renderer = new BrowserRenderer(logger, options)

		await renderer.init()

		let exitCode = 0

		if (options.interactive) {
			await options.interactive(renderer)
		} else {
			await renderer.waitForLoad()

			const waitForScripts: Promise<void>[] = []
			const maxDelay = Math.max(...options.scripts.map((s) => s.wait))
			for (const script of options.scripts) {
				await sleep(script.wait)

				if (script.takeScreenshot) {
					await renderer.takeScreenshot(script.takeScreenshot.name)
				}
				if (script.executeJs) {
					await renderer.executeJs(script.executeJs)
				}
				if (script.logInfo) {
					logger.info(script.logInfo)
				}

				if (script.startRecording) {
					const { fileName: videoFilename, stopped } = await renderer.record(
						script.startRecording.name,
						Math.max(500, maxDelay)
					)

					waitForScripts.push(
						stopped.then(async () => {
							try {
								if (script.startRecording?.cropped) {
									const croppedVideoFilename = `${videoFilename}-cropped.webm`
									await renderer.cropRecording(croppedVideoFilename)
									logger.info(`Cropped Video: ${videoFilename}`)
								}

								if (!script.startRecording?.full) {
									await fs.promises.rm(videoFilename)
								} else {
									logger.info(`Full Video: ${videoFilename}`)
								}
							} catch (e) {
								logger.error(`Aborting due to an error: ${e}`)
								exitCode = 1
							} finally {
								logger.verbose(`Removing temporary files...`)
								if (!script.startRecording?.full) {
									await fs.promises.rm(videoFilename)
								}
							}
						})
					)
				}
			}
			// End of loop
			if (renderer.isRecording) await renderer.stopRecording()

			await Promise.all(waitForScripts)
		}

		renderer.close()

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

export type InteractiveAPI = {
	waitForLoad: () => Promise<void>
	takeScreenshot: (fileName: string) => Promise<string>
	startRecording: (fileName: string, frameListener?: (frameIndex: number) => void) => Promise<string>
	stopRecording: () => Promise<string>
	cropRecording: (fileName: string) => Promise<string>
	executeJs: (js: string) => Promise<any>
}
