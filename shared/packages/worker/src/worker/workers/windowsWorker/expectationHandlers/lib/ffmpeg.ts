import { ChildProcess, spawn } from 'child_process'
import {
	isFileShareAccessorHandle,
	isHTTPAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../../accessorHandlers/accessor'
import { FileShareAccessorHandle } from '../../../../accessorHandlers/fileShare'
import { HTTPAccessorHandle } from '../../../../accessorHandlers/http'
import { LocalFolderAccessorHandle } from '../../../../accessorHandlers/localFolder'
import { assertNever } from '../../../../lib/lib'
import { WorkInProgress } from '../../../../lib/workInProgress'

export interface FFMpegProcess {
	kill: () => void
}
/** Spawn an ffmpeg process and make it to output its content to the target */
export async function runffMpeg<Metadata>(
	workInProgress: WorkInProgress,
	/** Arguments to send into ffmpeg, excluding the final arguments for output */
	args: string[],
	targetHandle:
		| LocalFolderAccessorHandle<Metadata>
		| FileShareAccessorHandle<Metadata>
		| HTTPAccessorHandle<Metadata>,
	actualSourceVersionHash: string,
	onDone: () => Promise<void>
): Promise<FFMpegProcess> {
	let FFMpegIsDone = false
	let uploadIsDone = false

	const maybeDone = () => {
		if (FFMpegIsDone && uploadIsDone) {
			onDone().catch((error) => {
				workInProgress._reportError(error)
			})
		}
	}

	let pipeStdOut = false
	if (isLocalFolderAccessorHandle(targetHandle)) {
		args.push(`"${targetHandle.fullPath}"`)
	} else if (isFileShareAccessorHandle(targetHandle)) {
		await targetHandle.prepareFileAccess()
		args.push(`"${targetHandle.fullPath}"`)
	} else if (isHTTPAccessorHandle(targetHandle)) {
		pipeStdOut = true
		args.push('pipe:1') // pipe output to stdout
	} else {
		assertNever(targetHandle)
		throw new Error(`Unsupported Target AccessHandler`)
	}

	const ffMpegProcess: ChildProcess = spawn(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', args, {
		shell: true,
	})

	if (pipeStdOut) {
		if (!ffMpegProcess.stdout) {
			throw new Error('No stdout stream available')
		}

		const writeStream = await targetHandle.putPackageStream(ffMpegProcess.stdout)
		writeStream.on('error', (err) => {
			workInProgress._reportError(err)
		})
		writeStream.once('close', () => {
			uploadIsDone = true
			maybeDone()
		})
	} else {
		uploadIsDone = true // no upload
	}
	let fileDuration: number | undefined = undefined
	ffMpegProcess.stderr?.on('data', (data) => {
		const str = data.toString()

		const m = str.match(/Duration:\s?(\d+):(\d+):([\d.]+)/)
		if (m) {
			const hh = m[1]
			const mm = m[2]
			const ss = m[3]

			fileDuration = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)
		} else {
			if (fileDuration) {
				const m2 = str.match(/time=\s?(\d+):(\d+):([\d.]+)/)
				if (m2) {
					const hh = m2[1]
					const mm = m2[2]
					const ss = m2[3]

					const progress = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)
					workInProgress._reportProgress(
						actualSourceVersionHash,
						((uploadIsDone ? 1 : 0.9) * progress) / fileDuration
					)
				}
			}
		}
	})
	ffMpegProcess.on('close', (code) => {
		// ffMpegProcess = undefined
		if (code === 0) {
			FFMpegIsDone = true
			maybeDone()
		} else {
			workInProgress._reportError(new Error(`Code ${code}`))
		}
	})

	// Report back an initial status, because it looks nice:
	workInProgress._reportProgress(actualSourceVersionHash, 0)

	return ffMpegProcess
}
