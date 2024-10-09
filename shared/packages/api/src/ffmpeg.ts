import { spawn } from 'child_process'
import { stringifyError } from './lib'

export interface OverriddenFFMpegExecutables {
	ffmpeg: string
	ffprobe: string
}

let overriddenFFMpegPaths: OverriddenFFMpegExecutables | null = null
/**
 * Override the paths of the ffmpeg executables, intended for unit testing purposes
 * @param paths Paths to executables
 */
export function overrideFFMpegExecutables(paths: OverriddenFFMpegExecutables | null): void {
	overriddenFFMpegPaths = paths
}

export interface FFMpegProcess {
	pid: number
	cancel: () => void
}
export function getFFMpegExecutable(): string {
	if (overriddenFFMpegPaths) return overriddenFFMpegPaths.ffmpeg
	return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}
export function getFFProbeExecutable(): string {
	if (overriddenFFMpegPaths) return overriddenFFMpegPaths.ffprobe
	return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}
/** Check if FFMpeg is available, returns null if no error found */
export async function testFFMpeg(): Promise<string | null> {
	return testFFExecutable(getFFMpegExecutable())
}
/** Check if FFProbe is available */
export async function testFFProbe(): Promise<string | null> {
	return testFFExecutable(getFFProbeExecutable())
}
export async function testFFExecutable(ffExecutable: string): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		const ffMpegProcess = spawn(ffExecutable, ['-version'])
		let output = ''
		ffMpegProcess.stderr.on('data', (data) => {
			const str = data.toString()
			output += str
		})
		ffMpegProcess.stdout.on('data', (data) => {
			const str = data.toString()
			output += str
		})
		ffMpegProcess.on('error', (err) => {
			resolve(`Process ${ffExecutable} emitted error: ${stringifyError(err)}`)
		})
		ffMpegProcess.on('exit', (code) => {
			const m = output.match(/version ([\w-]+)/) // version N-102494-g2899fb61d2

			if (code === 0) {
				if (m) {
					resolve(null)
				} else {
					resolve(`Process ${ffExecutable} bad version: ${output}`)
				}
			} else {
				resolve(`Process ${ffExecutable} exited with code ${code}`)
			}
		})
	})
}
