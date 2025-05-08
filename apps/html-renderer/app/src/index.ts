import { WebSocketServer } from 'ws'
import * as portFinder from 'portfinder'
import {
	setupLogger,
	initializeLogger,
	assertNever,
	InteractiveStdOut,
	InteractiveMessage,
	InteractiveReply,
} from '@sofie-package-manager/api'
import { renderHTML, RenderHTMLOptions, InteractiveAPI } from '@html-renderer/generic'
import { getHTMLRendererConfig } from './config'

const PACKAGE_VERSION = '1.50.5'

async function main(): Promise<void> {
	const config = await getHTMLRendererConfig()
	// eslint-disable-next-line no-console
	if (config.htmlRenderer.test) {
		// eslint-disable-next-line no-console
		console.log(`Version: ${PACKAGE_VERSION}`)
		// eslint-disable-next-line no-process-exit
		process.exit(0)
	}

	initializeLogger(config)
	const logger = setupLogger(config, '')

	let url = config.htmlRenderer.url
	if (!url) {
		throw new Error('No "url" parameter provided')
	}
	url = url.trim()
	// Is a url
	if (url.match(/^((https?)|(file))/)) {
		// Do nothing
	} else {
		// Assume it's a file path
		url = `file://${url.replace(/\\/g, '/')}`
	}

	let scripts: RenderHTMLOptions['scripts'] = []
	let interactive = undefined

	if (config.htmlRenderer.interactive) {
		interactive = async (api: InteractiveAPI) => {
			const port = await portFinder.getPortPromise()
			const wss = new WebSocketServer({
				port,
			})
			await new Promise<void>((resolve, reject) => {
				wss.once('listening', resolve)
				wss.once('error', reject)
			})

			await new Promise<void>((resolve, reject) => {
				const interactiveLogStdOut = (message: InteractiveStdOut) => {
					// eslint-disable-next-line no-console
					console.log(JSON.stringify(message))
				}

				// Signal that we're listening to at websocket port:
				interactiveLogStdOut({ status: 'listening', port })

				wss.on('connection', (ws) => {
					logger.info('client connected')

					const interactiveLog = (message: InteractiveReply) => {
						ws.send(JSON.stringify(message))
					}
					const onError = (message: any) => {
						interactiveLog(message)
						reject(new Error(message.error))
					}

					ws.on('message', (data) => {
						const str = data.toString()
						try {
							const message = JSON.parse(str) as InteractiveMessage
							if (typeof message === 'object') {
								if (message.do === 'waitForLoad') {
									api.waitForLoad()
										.then(() => interactiveLog({ reply: 'waitForLoad' }))
										.catch((e: unknown) => onError({ reply: 'waitForLoad', error: `${e}` }))
								} else if (message.do === 'takeScreenshot') {
									api.takeScreenshot(message.fileName)
										.then(() => interactiveLog({ reply: 'takeScreenshot' }))
										.catch((e: unknown) => onError({ reply: 'takeScreenshot', error: `${e}` }))
								} else if (message.do === 'startRecording') {
									api.startRecording(message.fileName)
										.then(() => interactiveLog({ reply: 'startRecording' }))
										.catch((e: unknown) => onError({ reply: 'startRecording', error: `${e}` }))
								} else if (message.do === 'stopRecording') {
									api.stopRecording()
										.then(() => interactiveLog({ reply: 'stopRecording' }))
										.catch((e: unknown) => onError({ reply: 'stopRecording', error: `${e}` }))
								} else if (message.do === 'cropRecording') {
									api.cropRecording(message.fileName)
										.then(() => interactiveLog({ reply: 'cropRecording' }))
										.catch((e: unknown) => onError({ reply: 'cropRecording', error: `${e}` }))
								} else if (message.do === 'executeJs') {
									api.executeJs(message.js)
										.then(() => interactiveLog({ reply: 'executeJs' }))
										.catch((e: unknown) => onError({ reply: 'executeJs', error: `${e}` }))
								} else if (message.do === 'close') {
									resolve()
								} else {
									assertNever(message)
									onError({ reply: 'unsupported', error: `Unsupported message: ${str}` })
								}
							} else onError({ reply: 'unsupported', error: `Unsupported message: ${str}` })
						} catch (e) {
							onError({ reply: 'unsupported', error: `Error parsing message (${e})` })
						}
					})
				})
			})
		}
	} else if (config.htmlRenderer.casparData) {
		const delayTime = config.htmlRenderer.casparDelay || 1000
		scripts = compact<RenderHTMLOptions['scripts'][0]>([
			{
				wait: 0,
				executeJs: `update(${config.htmlRenderer.casparData}); play();`,
				...(config.htmlRenderer.screenshots
					? {
							takeScreenshot: {
								name: 'idle.png',
							},
					  }
					: {}),
				...(config.htmlRenderer.recording || config.htmlRenderer['recording-cropped']
					? {
							startRecording: {
								name: 'recording.webm',
								full: config.htmlRenderer.recording,
								cropped: config.htmlRenderer['recording-cropped'],
							},
					  }
					: {}),
			},
			{
				wait: delayTime,
				...(config.htmlRenderer.screenshots
					? {
							takeScreenshot: {
								name: 'play.png',
							},
					  }
					: {}),
				executeJs: `stop()`,
			},
			{
				wait: delayTime,
				...(config.htmlRenderer.screenshots
					? {
							takeScreenshot: {
								name: 'stop.png',
							},
					  }
					: {}),
			},
		])
	} else if (
		config.htmlRenderer.genericWaitIdle ||
		config.htmlRenderer.genericWaitPlay ||
		config.htmlRenderer.genericWaitStop
	) {
		scripts = compact<RenderHTMLOptions['scripts'][0]>([
			{
				wait: config.htmlRenderer.genericWaitIdle || 0,
				logInfo: 'State: Idle',
				...(config.htmlRenderer.screenshots
					? {
							takeScreenshot: {
								name: 'idle.png',
							},
					  }
					: {}),
				...(config.htmlRenderer.recording || config.htmlRenderer['recording-cropped']
					? {
							startRecording: {
								name: 'recording.webm',
								full: config.htmlRenderer.recording,
								cropped: config.htmlRenderer['recording-cropped'],
							},
					  }
					: {}),
			},
			{
				wait: config.htmlRenderer.genericWaitPlay || 0,
				logInfo: 'State: Play',
				...(config.htmlRenderer.screenshots
					? {
							takeScreenshot: {
								name: 'play.png',
							},
					  }
					: {}),
			},
			{
				wait: config.htmlRenderer.genericWaitStop || 0,
				logInfo: 'State: Stop',
				...(config.htmlRenderer.screenshots
					? {
							takeScreenshot: {
								name: 'stop.png',
							},
					  }
					: {}),
			},
		])
	} else {
		throw new Error(
			'No "interactive", "casparData" or "genericWaitIdle"/"genericWaitPlay"/"genericWaitStop" parameters provided'
		)
	}
	if (scripts.length === 0) {
		logger.info(JSON.stringify(scripts))
	}

	const { exitCode, app } = await renderHTML({
		logger,
		width: config.htmlRenderer.width ?? 1920,
		height: config.htmlRenderer.height ?? 1080,
		zoom: config.htmlRenderer.zoom ?? 1,
		background: config.htmlRenderer.background,
		outputFolder: config.htmlRenderer.outputPath ?? '',
		tempFolder: config.htmlRenderer.tempPath ?? 'tmp',
		url,
		scripts,
		interactive,
	})
	logger.info('Done, exiting...')

	app.exit(exitCode)
}

main().catch((e) => {
	// eslint-disable-next-line no-console
	console.error(e)
	// eslint-disable-next-line no-process-exit
	process.exit(1)
})
function compact<T>(array: (T | undefined | null | false)[]): T[] {
	return array.filter(Boolean) as T[]
}
