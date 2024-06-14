import {
	setupLogger,
	initializeLogger,
	assertNever,
	InteractiveReply,
	InteractiveMessage,
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
	if (url.match(/^(https?)|(file)/)) {
		// Do nothing
	} else {
		// Assume it's a file path
		url = `file://${url.replace(/\\/g, '/')}`
	}

	let scripts: RenderHTMLOptions['scripts'] = []
	let interactive = undefined

	if (config.htmlRenderer.interactive) {
		interactive = async (api: InteractiveAPI) => {
			// Signal that we're ready to receive input:
			interactiveLog({ status: 'ready' })
			process.stdin.on('data', (data) => {
				const str = data.toString()
				try {
					const message = JSON.parse(str) as InteractiveMessage
					if (typeof message === 'object') {
						if (message.do === 'waitForLoad') {
							api.waitForLoad()
								.then(() => interactiveLog({ reply: 'waitForLoad' }))
								.catch((e: unknown) => interactiveLog({ reply: 'waitForLoad', error: `${e}` }))
						} else if (message.do === 'takeScreenshot') {
							api.takeScreenshot(message.fileName)
								.then(() => interactiveLog({ reply: 'takeScreenshot' }))
								.catch((e: unknown) => interactiveLog({ reply: 'takeScreenshot', error: `${e}` }))
						} else if (message.do === 'startRecording') {
							api.startRecording(message.fileName)
								.then(() => interactiveLog({ reply: 'startRecording' }))
								.catch((e: unknown) => interactiveLog({ reply: 'startRecording', error: `${e}` }))
						} else if (message.do === 'stopRecording') {
							api.stopRecording()
								.then(() => interactiveLog({ reply: 'stopRecording' }))
								.catch((e: unknown) => interactiveLog({ reply: 'stopRecording', error: `${e}` }))
						} else if (message.do === 'cropRecording') {
							api.cropRecording(message.fileName)
								.then(() => interactiveLog({ reply: 'cropRecording' }))
								.catch((e: unknown) => interactiveLog({ reply: 'cropRecording', error: `${e}` }))
						} else if (message.do === 'executeJs') {
							api.executeJs(message.js)
								.then(() => interactiveLog({ reply: 'executeJs' }))
								.catch((e: unknown) => interactiveLog({ reply: 'executeJs', error: `${e}` }))
						} else {
							assertNever(message)
							interactiveLog({ reply: 'unsupported', error: `Unsupported message: ${str}` })
						}
					} else interactiveLog({ reply: 'unsupported', error: `Unsupported message: ${str}` })
				} catch (e) {
					interactiveLog({ reply: 'unsupported', error: `Error parsing message (${e})` })
				}
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
								name: 'recording',
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
								name: 'recording',
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
	logger.info(JSON.stringify(scripts))

	const { exitCode, app } = await renderHTML({
		logger,
		width: config.htmlRenderer.width ?? 1920,
		height: config.htmlRenderer.height ?? 1080,
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
	console.error(e)
	// eslint-disable-next-line no-process-exit
	process.exit(1)
})
function compact<T>(array: (T | undefined | null | false)[]): T[] {
	return array.filter(Boolean) as T[]
}

function interactiveLog(message: InteractiveReply) {
	// eslint-disable-next-line no-console
	console.log(JSON.stringify(message))
}
