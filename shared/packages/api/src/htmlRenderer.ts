import { spawn, ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { isRunningInDevelopment, stringifyError } from './lib'

let overriddenHTMLRendererPath: string | null = null
/**
 * Override the paths of the html-renderer executables, intended for unit testing purposes or when running in development mode
 * @param paths Paths to executables
 */
export function overrideHTMLRendererExecutables(overridePath: string | null): void {
	overriddenHTMLRendererPath = overridePath
}

export interface HTMLRendererProcess {
	pid: number
	cancel: () => void
}
let htmlRenderExecutable = 'N/A' // Is set when testHtmlRenderer is run
function getHtmlRendererExecutable(): string {
	if (overriddenHTMLRendererPath) return overriddenHTMLRendererPath
	return htmlRenderExecutable
}

export function spawnHtmlRendererExecutable(
	args: string[],
	options?: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams {
	const executable = getHtmlRendererExecutable()

	if (executable.includes('yarn --cwd')) {
		// Is is development mode and executing using yarn. Use shell mode:
		return spawn(executable, args, {
			...options,
			shell: true,
		})
	} else {
		return spawn(executable, args, options)
	}
}
/** Check if HTML-Renderer is available, returns null if no error found */
export async function testHtmlRenderer(): Promise<string | null> {
	if (htmlRenderExecutable === 'N/A') {
		let alternatives: string[]
		if (process.platform === 'win32') {
			alternatives = [
				'html-renderer.exe',
				path.resolve('html-renderer/html-renderer.exe'),
				path.resolve('../html-renderer/html-renderer.exe'),
				path.resolve('../../html-renderer/app/deploy/html-renderer/html-renderer.exe'),
			]
		} else {
			alternatives = [
				'./html-renderer',
				path.resolve('html-renderer/html-renderer'),
				path.resolve('../html-renderer'),
				path.resolve('../html-renderer/html-renderer'),
				path.resolve('../../html-renderer/app/deploy/linux-unpacked/html-renderer'),
			]
		}

		for (const alternative of alternatives) {
			// check if it exists
			try {
				await fs.access(alternative, fs.constants.X_OK)
			} catch {
				continue
			}
			// If it exists, use that path:
			htmlRenderExecutable = alternative
		}

		if (htmlRenderExecutable === 'N/A') {
			if (isRunningInDevelopment()) {
				// Process runs as a node process, we're probably in development mode.
				// Use the source code directly instead of the executable:
				overrideHTMLRendererExecutables(`yarn --cwd ${path.resolve('../../html-renderer/app')} start`)
			} else {
				return `Not able to find any HTML-Renderer executable, tried: ${alternatives.join(', ')}`
			}
		}
	}

	return testHtmlRendererExecutable()
}

export async function testHtmlRendererExecutable(): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		const executablePath = getHtmlRendererExecutable()
		const htmlRendererProcess = spawnHtmlRendererExecutable(['--', '--test=true'])
		let output = ''
		htmlRendererProcess.stderr.on('data', (data) => {
			const str = data.toString()
			output += str
		})
		htmlRendererProcess.stdout.on('data', (data) => {
			const str = data.toString()
			output += str
		})
		htmlRendererProcess.on('error', (err) => {
			resolve(`Process ${executablePath} emitted error: ${stringifyError(err)}`)
		})
		htmlRendererProcess.on('exit', (code) => {
			const m = output.match(/Version: ([\w.]+)/i) // Version 1.50.1

			if (code === 0) {
				if (m) {
					resolve(null)
				} else {
					resolve(`Process ${executablePath} bad version: "${output}"`)
				}
			} else {
				resolve(`Process ${executablePath} exited with code ${code}`)
			}
		})
	})
}

/** Messages sent from HTMLRenderer process over stdout */
export type InteractiveStdOut = { status: 'listening'; port: number }

/** Messages sent into HTMLRenderer process over websocket */
export type InteractiveMessage =
	// Tell the HTML Renderer to wait for the page to load, it'll then emit the waitForLoad reply when page has loaded
	| { do: 'waitForLoad' }
	// Tell the HTML Renderer to take a screenshot, it'll then emit the takeScreenshot reply when done
	| { do: 'takeScreenshot'; fileName: string }
	// Tell the HTML Renderer to start recording, it'll then emit the startRecording reply when the recording has started
	| { do: 'startRecording'; fileName: string }
	// Tell the HTML Renderer to stop recording, it'll then emit the stopRecording reply when the recording has stopped
	| { do: 'stopRecording' }
	// Tell the HTML Renderer to crop the recording, it'll then emit the cropRecording reply when the recording has been cropped
	| { do: 'cropRecording'; fileName: string }
	// Tell the HTML Renderer to execute some JavaScript in the page, it'll then emit the executeJs reply when the script has been executed
	| { do: 'executeJs'; js: string }
	// Tell the HTML Renderer to close and quit
	| { do: 'close' }
/** Messages sent from HTMLRenderer process over websocket */
export type InteractiveReply =
	| { reply: 'unsupported'; error: string }
	| { reply: 'waitForLoad'; error?: string }
	| { reply: 'takeScreenshot'; error?: string }
	| { reply: 'startRecording'; error?: string }
	| { reply: 'stopRecording'; error?: string }
	| { reply: 'cropRecording'; error?: string }
	| { reply: 'executeJs'; error?: string }
