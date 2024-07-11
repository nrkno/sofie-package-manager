import yargs = require('yargs/yargs')
import {
	ProcessConfig,
	getProcessConfig,
	processOptions,
	defineArguments,
	getProcessArgv,
} from '@sofie-package-manager/api'

/*
 * This file contains various CLI argument definitions, used by the various processes that together constitutes the Package Manager
 */

/** Generic CLI-argument-definitions for any process */
const htmlRendererOptions = defineArguments({
	url: { type: 'string', describe: 'URL or path to the file to be rendered' },
	width: { type: 'number', describe: 'Width of the HTML renderer (default: 1920)' },
	height: { type: 'number', describe: 'Width of the HTML renderer (default: 1080)' },
	zoom: { type: 'number', describe: 'Zoom factor of the HTML renderer (default: 1)' },
	outputPath: { type: 'string', describe: 'File path to where the output files will be saved' },
	tempPath: { type: 'string', describe: 'File path to where temporary files will be saved (default: "tmp")' },
	screenshots: { type: 'boolean', describe: 'When true, will capture screenshots' },
	recording: { type: 'boolean', describe: 'When true, will capture recording' },
	'recording-cropped': {
		type: 'boolean',
		describe: 'When true, will capture a recording cropped to the non-black area',
	},
	casparData: { type: 'string', describe: '(JSON) data to send into the update() function of a CasparCG Template' },
	casparDelay: {
		type: 'number',
		describe: 'How long to wait between each action in a CasparCG template (default: 1000ms)',
	},
	genericWaitIdle: {
		type: 'number',
		describe: 'For a generic HTML template, how long to wait before considering it idle',
	},
	genericWaitPlay: {
		type: 'number',
		describe: 'For a generic HTML template, how long to wait before considering it playing',
	},
	genericWaitStop: {
		type: 'number',
		describe: 'For a generic HTML template, how long to wait before considering it stopped',
	},
	interactive: {
		type: 'boolean',
		describe: 'When true, will start the process in interactive mode. See Readme for docs.',
	},
	test: {
		type: 'boolean',
		describe: 'When true, will simply trace the version and then close.',
	},
})

export interface HTMLRendererOptionsConfig {
	url: string | undefined
	width: number | undefined
	height: number | undefined
	zoom: number | undefined
	outputPath: string | undefined
	tempPath: string | undefined
	screenshots: boolean | undefined
	recording: boolean | undefined
	'recording-cropped': boolean | undefined
	casparData: string | undefined
	casparDelay: number | undefined
	genericWaitIdle: number | undefined
	genericWaitPlay: number | undefined
	genericWaitStop: number | undefined
	interactive: boolean | undefined
	test: boolean | undefined
}
export async function getHTMLRendererConfig(): Promise<{
	process: ProcessConfig
	htmlRenderer: HTMLRendererOptionsConfig
}> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...processOptions,
			...htmlRendererOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		htmlRenderer: {
			url: argv.url,
			width: argv.width,
			height: argv.height,
			zoom: argv.zoom,
			outputPath: argv.outputPath,
			tempPath: argv.tempPath,
			screenshots: argv.screenshots,
			recording: argv.recording,
			'recording-cropped': argv['recording-cropped'],
			casparData: argv.casparData,
			casparDelay: argv.casparDelay,
			genericWaitIdle: argv.genericWaitIdle,
			genericWaitPlay: argv.genericWaitPlay,
			genericWaitStop: argv.genericWaitStop,
			interactive: argv.interactive,
			test: argv.test,
		},
	}
}

// ---------------------------------------------------------------------------------
