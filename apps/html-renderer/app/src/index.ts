import { setupLogger, initializeLogger } from '@sofie-package-manager/api'
import { renderHTML, RenderHTMLOptions } from '@html-renderer/generic'
import { getHTMLRendererConfig } from './config'

async function main(): Promise<void> {
	const config = await getHTMLRendererConfig()

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

	if (config.htmlRenderer.casparData) {
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
		throw new Error('No "casparData" or "genericWaitIdle"/"genericWaitPlay"/"genericWaitStop" parameters provided')
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
