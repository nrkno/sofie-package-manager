import * as cp from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { CancelablePromise } from '../../../lib/cancelablePromise'

export function roboCopyFile(src: string, dst: string, progress?: (progress: number) => void): CancelablePromise<void> {
	if (process.platform !== 'win32') {
		throw new Error('Only Win32 environment is supported for RoboCopy')
	}
	return new CancelablePromise<void>((resolve, reject, onCancel) => {
		const srcFolder = path.dirname(src)
		const dstFolder = path.dirname(dst)
		const srcFileName = path.basename(src)
		const dstFileName = path.basename(dst)

		let rbcpy: cp.ChildProcess | undefined = cp.spawn('robocopy', [
			'/bytes',
			'/njh', // Specifies that there is no job header.
			'/njs', // Specifies that there is no job summary.
			// '/mt', // multi-threading
			// '/z', // Copies files in restartable mode.
			srcFolder,
			dstFolder,
			srcFileName,
		])

		// Change priority of the process:
		cp.exec(`wmic process where "ProcessId=${rbcpy.pid}" CALL setpriority 16384`) // 16384="below normal"

		const errors: string[] = []
		const output: string[] = []

		if (!rbcpy.stdout) throw new Error(`Unknown error: rbcpy.stdout is null`)
		if (!rbcpy.stderr) throw new Error(`Unknown error: rbcpy.stderr is null`)

		rbcpy.stdout.on('data', (data) => {
			const m = data
				.toString()
				.trim()
				.match(/(\d+\.?\d+)%$/) // match the last reported number in the output
			if (m) {
				const num = parseFloat(m[1])
				if (typeof progress === 'function') {
					progress(num)
				}
			}
			output.push(data.toString())
		})

		rbcpy.stderr.on('data', (data) => {
			errors.push(data.toString().trim())
		})

		rbcpy.on('exit', (code) => {
			rbcpy = undefined
			if (
				code === 0 || // No errors occurred, and no copying was done.
				(code && (code & 1) === 1) // One or more files were copied successfully (that is, new files have arrived).
			) {
				// Robocopy's code for succesfully copying files is 1 at LSB: https://ss64.com/nt/robocopy-exit.html
				if (srcFileName !== dstFileName) {
					fs.rename(path.join(dstFolder, srcFileName), path.join(dstFolder, dstFileName), (err) => {
						if (err) {
							reject(err)
							return
						}
						resolve()
					})
				} else {
					resolve()
				}
			} else {
				reject(`RoboCopy failed with code ${code}: ${output.join(', ')}, ${errors.join(', ')}`)
			}
		})

		onCancel(() => {
			if (rbcpy !== undefined) {
				cp.spawn('taskkill', ['/pid', rbcpy.pid.toString(), '/f', '/t'])
				rbcpy = undefined
			}
		})
	})
}
