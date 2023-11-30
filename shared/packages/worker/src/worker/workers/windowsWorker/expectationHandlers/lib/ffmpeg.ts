import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import path from 'path'
import { mkdirp } from 'mkdirp'
import {
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../../accessorHandlers/accessor'
import { FileShareAccessorHandle } from '../../../../accessorHandlers/fileShare'
import { HTTPProxyAccessorHandle } from '../../../../accessorHandlers/httpProxy'
import { LocalFolderAccessorHandle } from '../../../../accessorHandlers/localFolder'
import { assertNever, stringifyError } from '@sofie-package-manager/api'

export interface FFMpegProcess {
	pid: number
	cancel: () => void
}
export function getFFMpegExecutable(): string {
	return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}
export function getFFProbeExecutable(): string {
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

/** Spawn an ffmpeg process and make it to output its content to the target */
export async function spawnFFMpeg<Metadata>(
	/** Arguments to send into ffmpeg, excluding the final arguments for output */
	args: string[],
	targetHandle:
		| LocalFolderAccessorHandle<Metadata>
		| FileShareAccessorHandle<Metadata>
		| HTTPProxyAccessorHandle<Metadata>,
	onDone: () => Promise<void>,
	onFail: (err?: any) => Promise<void>,
	onProgress?: (progress: number) => Promise<void>,
	log?: (str: string) => void
): Promise<FFMpegProcess> {
	let FFMpegIsDone = false
	let uploadIsDone = false

	const maybeDone = () => {
		if (FFMpegIsDone && uploadIsDone) {
			onDone().catch((error) => {
				// workInProgress._reportError(error)
				onFail(error).catch((error) => log?.(`spawnFFMpeg onFail callback failed: ${stringifyError(error)}`))
			})
		}
	}

	let pipeStdOut = false
	if (isLocalFolderAccessorHandle(targetHandle)) {
		await mkdirp(path.dirname(targetHandle.fullPath)) // Create folder if it doesn't exist
		args.push(`"${targetHandle.fullPath}"`)
	} else if (isFileShareAccessorHandle(targetHandle)) {
		await targetHandle.prepareFileAccess()
		await mkdirp(path.dirname(targetHandle.fullPath)) // Create folder if it doesn't exist
		args.push(`"${targetHandle.fullPath}"`)
	} else if (isHTTPProxyAccessorHandle(targetHandle)) {
		pipeStdOut = true
		args.push('pipe:1') // pipe output to stdout
	} else {
		assertNever(targetHandle)
		throw new Error(`Unsupported Target AccessHandler`)
	}

	log?.('ffmpeg: spawn..')
	let ffMpegProcess: ChildProcessWithoutNullStreams | undefined = spawn(getFFMpegExecutable(), args, {
		windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
	})
	log?.('ffmpeg: spawned')

	function killFFMpeg() {
		// ensure this function doesn't throw, since it is called from various error event handlers
		try {
			ffMpegProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
			ffMpegProcess?.kill()
		} catch (e) {
			// This is probably OK, errors likely means that the process is already dead
		}
		ffMpegProcess = undefined
	}

	if (pipeStdOut) {
		log?.('ffmpeg: pipeStdOut')
		if (!ffMpegProcess.stdout) {
			throw new Error('No stdout stream available')
		}

		const writeStream = await targetHandle.putPackageStream(ffMpegProcess.stdout)
		writeStream.on('error', (err) => {
			onFail(err).catch((error) => log?.(`onFail callback failed: ${stringifyError(error)}`))
			log?.('ffmpeg: pipeStdOut err: ' + stringifyError(err))
			killFFMpeg()
		})
		writeStream.once('close', () => {
			uploadIsDone = true

			maybeDone()
			log?.('ffmpeg: pipeStdOut done')
		})
	} else {
		uploadIsDone = true // no upload
	}
	const lastFewLines: string[] = []

	let fileDuration: number | undefined = undefined
	ffMpegProcess.stderr.on('data', (data) => {
		const str = data.toString()

		log?.('ffmpeg:' + str)

		// Duration is reported by FFMpeg at the beginning, this means that it successfully opened the source
		// stream and has begun processing
		const m = str.match(/Duration:\s?(\d+):(\d+):([\d.]+)/)
		if (m) {
			const hh = m[1]
			const mm = m[2]
			const ss = m[3]

			fileDuration = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)

			// Report back an initial status, because it looks nice:
			// workInProgress._reportProgress(actualSourceVersionHash, 0)
			onProgress?.(0).catch((err) => log?.(`spawnFFMpeg onProgress update failed: ${stringifyError(err)}`))

			return
		}
		if (fileDuration) {
			// Time position in source is reported periodically, but we need fileDuration to convert that into
			// percentages
			const m2 = str.match(/time=\s?(\d+):(\d+):([\d.]+)/)
			if (m2) {
				const hh = m2[1]
				const mm = m2[2]
				const ss = m2[3]

				const progress = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)
				// workInProgress._reportProgress(
				// 	actualSourceVersionHash,
				// 	((uploadIsDone ? 1 : 0.9) * progress) / fileDuration
				// )
				onProgress?.(((uploadIsDone ? 1 : 0.9) * progress) / fileDuration).catch((err) =>
					log?.(`spawnFFMpeg onProgress update failed: ${stringifyError(err)}`)
				)
				return
			}
		}

		lastFewLines.push(str)

		if (lastFewLines.length > 10) {
			lastFewLines.shift()
		}
	})
	const onClose = (code: number | null) => {
		if (ffMpegProcess) {
			log?.('ffmpeg: close ' + code)
			ffMpegProcess = undefined
			if (code === 0) {
				FFMpegIsDone = true
				maybeDone()
			} else {
				// workInProgress._reportError(new Error(`FFMpeg exit code ${code}: ${lastFewLines.join('\n')}`))
				onFail(new Error(`FFMpeg exit code ${code}: ${lastFewLines.join('\n')}`)).catch((err) =>
					log?.(`spawnFFMpeg onFail callback failed: ${stringifyError(err)}`)
				)
			}
		}
	}
	ffMpegProcess.on('close', (code) => {
		onClose(code)
	})
	ffMpegProcess.on('exit', (code) => {
		onClose(code)
	})
	ffMpegProcess.on('error', (err) => {
		log?.(`spawnFFMpeg error: ${stringifyError(err)}`)
	})

	return {
		pid: ffMpegProcess.pid ?? 0,
		cancel: () => {
			killFFMpeg()
			onFail(`Cancelled`).catch((err) => log?.(`spawnFFMpeg onFail callback failed: ${stringifyError(err)}`))
		},
	}
}
