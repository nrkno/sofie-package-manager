import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { stringifyError } from './lib'

let overriddenHTMLRendererPath: string | null = null
/**
 * Override the paths of the html-renderer executables, intended for unit testing purposes
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
export function getHtmlRendererExecutable(): string {
	if (overriddenHTMLRendererPath) return overriddenHTMLRendererPath
	return htmlRenderExecutable
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
				'html-renderer',
				path.resolve('html-renderer/html-renderer'),
				path.resolve('../html-renderer'),
				path.resolve('../html-renderer/html-renderer'),
				path.resolve('../../html-renderer/app/deploy/html-renderer/html-renderer'),
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
	}

	return testExecutable(getHtmlRendererExecutable())
}

export async function testExecutable(executable: string): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		const htmlRendererProcess = spawn(executable, ['--', '--test=true'])
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
			resolve(`Process ${executable} emitted error: ${stringifyError(err)}`)
		})
		htmlRendererProcess.on('exit', (code) => {
			const m = output.match(/version ([\w.]+)/) // version 1.50.1

			if (code === 0) {
				if (m) {
					resolve(null)
				} else {
					resolve(`Process ${executable} bad version: ${output}`)
				}
			} else {
				resolve(`Process ${executable} exited with code ${code}`)
			}
		})
	})
}

/** Messages sent into HTMLRenderer process over stdin */
export type InteractiveMessage =
	| { do: 'waitForLoad' }
	| { do: 'takeScreenshot'; fileName: string }
	| { do: 'startRecording'; fileName: string }
	| { do: 'stopRecording' }
	| { do: 'cropRecording'; fileName: string }
	| { do: 'executeJs'; js: string }
/** Messages sent from HTMLRenderer process over stdout */
export type InteractiveReply =
	| { status: 'ready' }
	| { reply: 'unsupported'; error: string }
	| { reply: 'waitForLoad'; error?: string }
	| { reply: 'takeScreenshot'; error?: string }
	| { reply: 'startRecording'; error?: string }
	| { reply: 'stopRecording'; error?: string }
	| { reply: 'cropRecording'; error?: string }
	| { reply: 'executeJs'; error?: string }
