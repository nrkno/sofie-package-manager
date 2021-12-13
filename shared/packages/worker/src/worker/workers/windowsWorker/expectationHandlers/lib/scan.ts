import { exec, ChildProcess, spawn } from 'child_process'
import { Expectation, assertNever } from '@shared/api'
import {
	isQuantelClipAccessorHandle,
	isLocalFolderAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isHTTPAccessorHandle,
} from '../../../../accessorHandlers/accessor'
import { LocalFolderAccessorHandle } from '../../../../accessorHandlers/localFolder'
import { QuantelAccessorHandle } from '../../../../accessorHandlers/quantel'
import { CancelablePromise } from '../../../../lib/cancelablePromise'
import { FieldOrder, ScanAnomaly } from './coreApi'
import { generateFFProbeFromClipData } from './quantelFormats'
import { FileShareAccessorHandle } from '../../../../accessorHandlers/fileShare'
import { HTTPProxyAccessorHandle } from '../../../../accessorHandlers/httpProxy'
import { HTTPAccessorHandle } from '../../../../accessorHandlers/http'

interface FFProbeScanResult {
	// to be defined...
	format?: {
		duration: number
	}
}
export function scanWithFFProbe(
	sourceHandle:
		| LocalFolderAccessorHandle<any>
		| FileShareAccessorHandle<any>
		| HTTPAccessorHandle<any>
		| HTTPProxyAccessorHandle<any>
		| QuantelAccessorHandle<any>
): CancelablePromise<FFProbeScanResult> {
	return new CancelablePromise<FFProbeScanResult>(async (resolve, reject, onCancel) => {
		if (
			isLocalFolderAccessorHandle(sourceHandle) ||
			isFileShareAccessorHandle(sourceHandle) ||
			isHTTPAccessorHandle(sourceHandle) ||
			isHTTPProxyAccessorHandle(sourceHandle)
		) {
			let inputPath: string
			let filePath: string
			if (isLocalFolderAccessorHandle(sourceHandle)) {
				inputPath = sourceHandle.fullPath
				filePath = sourceHandle.filePath
			} else if (isFileShareAccessorHandle(sourceHandle)) {
				await sourceHandle.prepareFileAccess()
				inputPath = sourceHandle.fullPath
				filePath = sourceHandle.filePath
			} else if (isHTTPAccessorHandle(sourceHandle)) {
				inputPath = sourceHandle.fullUrl
				filePath = sourceHandle.path
			} else if (isHTTPProxyAccessorHandle(sourceHandle)) {
				inputPath = sourceHandle.fullUrl
				filePath = sourceHandle.filePath
			} else {
				assertNever(sourceHandle)
				throw new Error('Unknown handle')
			}
			// Use FFProbe to scan the file:
			const args = [
				process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
				'-hide_banner',
				`-i "${inputPath}"`,
				'-show_streams',
				'-show_format',
				'-print_format',
				'json',
			]
			let ffProbeProcess: ChildProcess | undefined = undefined
			onCancel(() => {
				ffProbeProcess?.kill()
			})

			ffProbeProcess = exec(args.join(' '), (err, stdout, _stderr) => {
				// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
				ffProbeProcess = undefined
				if (err) {
					reject(err)
					return
				}
				const json: any = JSON.parse(stdout)
				if (!json.streams || !json.streams[0]) {
					reject(new Error(`File doesn't seem to be a media file`))
					return
				}
				json.filePath = filePath
				resolve(json)
			})
		} else if (isQuantelClipAccessorHandle(sourceHandle)) {
			// Because we have no good way of using ffprobe to generate the into we want,
			// we resort to faking it:

			const clip = await sourceHandle.getClip()
			if (!clip) throw new Error('Source not found')

			const clipDetails = await sourceHandle.getClipDetails(clip.ClipID)
			if (!clipDetails) throw new Error(`Source clip details not found`)

			const scanResult = generateFFProbeFromClipData(clipDetails)

			resolve(scanResult)
		} else {
			assertNever(sourceHandle)
		}
	})
}

export function scanFieldOrder(
	sourceHandle:
		| LocalFolderAccessorHandle<any>
		| FileShareAccessorHandle<any>
		| HTTPAccessorHandle<any>
		| HTTPProxyAccessorHandle<any>
		| QuantelAccessorHandle<any>,
	targetVersion: Expectation.PackageDeepScan['endRequirement']['version']
): CancelablePromise<FieldOrder> {
	return new CancelablePromise<FieldOrder>(async (resolve, reject, onCancel) => {
		if (!targetVersion.fieldOrder) {
			resolve(FieldOrder.Unknown)
			return
		}

		const args = [
			process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
			'-hide_banner',
			'-filter:v idet',
			`-frames:v ${targetVersion.fieldOrderScanDuration || 200}`,
			'-an',
			'-f',
			'rawvideo',
			'-y',
			process.platform === 'win32' ? 'NUL' : '/dev/null',
		]

		if (isLocalFolderAccessorHandle(sourceHandle)) {
			args.push(`-i "${sourceHandle.fullPath}"`)
		} else if (isFileShareAccessorHandle(sourceHandle)) {
			await sourceHandle.prepareFileAccess()
			args.push(`-i "${sourceHandle.fullPath}"`)
		} else if (isHTTPAccessorHandle(sourceHandle)) {
			args.push(`-i "${sourceHandle.fullUrl}"`)
		} else if (isHTTPProxyAccessorHandle(sourceHandle)) {
			args.push(`-i "${sourceHandle.fullUrl}"`)
		} else if (isQuantelClipAccessorHandle(sourceHandle)) {
			const httpStreamURL = await sourceHandle.getTransformerStreamURL()

			if (!httpStreamURL.success) throw new Error(`Source Clip not found (${httpStreamURL.reason.tech})`)

			args.push('-seekable 0')
			args.push(`-i "${httpStreamURL.fullURL}"`)
		} else {
			assertNever(sourceHandle)
		}

		let ffProbeProcess: ChildProcess | undefined = undefined
		onCancel(() => {
			ffProbeProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
			ffProbeProcess?.kill()
			reject('Cancelled')
		})

		ffProbeProcess = exec(args.join(' '), (err, _stdout, stderr) => {
			// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
			ffProbeProcess = undefined
			if (err) {
				reject(err)
				return
			}

			const FieldRegex = /Multi frame detection: TFF:\s+(\d+)\s+BFF:\s+(\d+)\s+Progressive:\s+(\d+)/

			const res = FieldRegex.exec(stderr)
			if (res === null) {
				resolve(FieldOrder.Unknown)
			} else {
				const tff = parseInt(res[1])
				const bff = parseInt(res[2])
				const fieldOrder =
					tff <= 10 && bff <= 10 ? FieldOrder.Progressive : tff > bff ? FieldOrder.TFF : FieldOrder.BFF
				resolve(fieldOrder)
			}
		})
	})
}

export function scanMoreInfo(
	sourceHandle:
		| LocalFolderAccessorHandle<any>
		| FileShareAccessorHandle<any>
		| HTTPAccessorHandle<any>
		| HTTPProxyAccessorHandle<any>
		| QuantelAccessorHandle<any>,
	previouslyScanned: FFProbeScanResult,
	targetVersion: Expectation.PackageDeepScan['endRequirement']['version'],
	/** Callback which is called when there is some new progress */
	onProgress: (
		/** Progress, goes from 0 to 1 */
		progress: number
	) => void
): CancelablePromise<{
	scenes: number[]
	freezes: ScanAnomaly[]
	blacks: ScanAnomaly[]
}> {
	return new CancelablePromise<{
		scenes: number[]
		freezes: ScanAnomaly[]
		blacks: ScanAnomaly[]
	}>(async (resolve, reject, onCancel) => {
		let filterString = ''
		if (targetVersion.blackDetection) {
			if (targetVersion.blackDuration && targetVersion.blackDuration?.endsWith('s')) {
				targetVersion.blackDuration = targetVersion.blackDuration.slice(0, -1)
			}
			filterString +=
				`blackdetect=d=${targetVersion.blackDuration || '2.0'}:` +
				`pic_th=${targetVersion.blackRatio || 0.98}:` +
				`pix_th=${targetVersion.blackThreshold || 0.1}`
		}

		if (targetVersion.freezeDetection) {
			if (filterString) {
				filterString += ','
			}
			filterString +=
				`freezedetect=n=${targetVersion.freezeNoise || 0.001}:` + `d=${targetVersion.freezeDuration || '2s'}`
		}

		if (targetVersion.scenes) {
			if (filterString) {
				filterString += ','
			}
			filterString += `"select='gt(scene,${targetVersion.sceneThreshold || 0.4})',showinfo"`
		}

		const args = ['-hide_banner']

		if (isLocalFolderAccessorHandle(sourceHandle)) {
			args.push(`-i "${sourceHandle.fullPath}"`)
		} else if (isFileShareAccessorHandle(sourceHandle)) {
			await sourceHandle.prepareFileAccess()
			args.push(`-i "${sourceHandle.fullPath}"`)
		} else if (isHTTPAccessorHandle(sourceHandle)) {
			args.push(`-i "${sourceHandle.fullUrl}"`)
		} else if (isHTTPProxyAccessorHandle(sourceHandle)) {
			args.push(`-i "${sourceHandle.fullUrl}"`)
		} else if (isQuantelClipAccessorHandle(sourceHandle)) {
			const httpStreamURL = await sourceHandle.getTransformerStreamURL()

			if (!httpStreamURL.success) throw new Error(`Source Clip not found (${httpStreamURL.reason.tech})`)

			args.push('-seekable 0')
			args.push(`-i "${httpStreamURL.fullURL}"`)
		} else {
			assertNever(sourceHandle)
		}
		args.push('-filter:v', filterString)
		args.push('-an')
		args.push('-f null')
		args.push('-threads 1')
		args.push('-')

		let ffMpegProcess: ChildProcess | undefined = undefined

		onCancel(() => {
			ffMpegProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
			ffMpegProcess?.kill()
		})

		ffMpegProcess = spawn(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', args, { shell: true })

		const scenes: number[] = []
		const freezes: ScanAnomaly[] = []
		const blacks: ScanAnomaly[] = []

		// TODO current frame is not read?
		// let currentFrame = 0

		// ffProbeProcess.stdout.on('data', () => { lastProgressReportTimestamp = new Date() })
		if (!ffMpegProcess.stderr) {
			throw new Error('spawned ffprobe-process stdin is null!')
		}
		let lastString = ''
		let fileDuration: number | undefined = undefined
		ffMpegProcess.stderr.on('data', (data: any) => {
			const stringData = data.toString()

			if (typeof stringData !== 'string') return

			lastString = stringData

			const frameRegex = /^frame= +\d+/g
			const timeRegex = /time=\s?(\d+):(\d+):([\d.]+)/
			const durationRegex = /Duration:\s?(\d+):(\d+):([\d.]+)/
			const sceneRegex = /Parsed_showinfo_(.*)pts_time:([\d.]+)\s+/g
			const blackDetectRegex = /(black_start:)(\d+(.\d+)?)( black_end:)(\d+(.\d+)?)( black_duration:)(\d+(.\d+))?/g
			const freezeDetectStart = /(lavfi\.freezedetect\.freeze_start: )(\d+(.\d+)?)/g
			const freezeDetectDuration = /(lavfi\.freezedetect\.freeze_duration: )(\d+(.\d+)?)/g
			const freezeDetectEnd = /(lavfi\.freezedetect\.freeze_end: )(\d+(.\d+)?)/g

			try {
				const frameMatch = stringData.match(frameRegex)
				if (frameMatch) {
					const timeMatch = stringData.match(timeRegex)
					if (timeMatch) {
						const hh = timeMatch[1]
						const mm = timeMatch[2]
						const ss = timeMatch[3]

						const time = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)

						if (fileDuration) {
							onProgress(time / fileDuration)
						}
					}

					// currentFrame = Number(frameMatch[0].replace('frame=', ''))
				} else {
					const durationMatch = stringData.match(durationRegex)
					if (durationMatch) {
						const hh = durationMatch[1]
						const mm = durationMatch[2]
						const ss = durationMatch[3]

						fileDuration = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)
					}
					let res: RegExpExecArray | null
					while ((res = sceneRegex.exec(stringData)) !== null) {
						scenes.push(parseFloat(res[2]))
					}

					while ((res = blackDetectRegex.exec(stringData)) !== null) {
						blacks.push({
							start: parseFloat(res[2]),
							duration: parseFloat(res[8]),
							end: parseFloat(res[5]),
						})
					}

					while ((res = freezeDetectStart.exec(stringData)) !== null) {
						freezes.push({
							start: parseFloat(res[2]),
							duration: 0.0,
							end: 0.0,
						})
					}

					let i = 0
					while ((res = freezeDetectDuration.exec(stringData)) !== null) {
						freezes[i++].duration = parseFloat(res[2])
					}

					i = 0
					while ((res = freezeDetectEnd.exec(stringData)) !== null) {
						freezes[i++].end = parseFloat(res[2])
					}
				}
			} catch (err) {
				if (err && typeof err === 'object') {
					// If there was an error parsing the output, we should also provide the string we tried to parse:
					;(err as any).context = stringData
				}
				throw err
			}
		})

		const onClose = (code: number | null) => {
			if (ffMpegProcess) {
				ffMpegProcess = undefined
				if (code === 0) {
					// success

					// If freeze frame is the end of video, it is not detected fully:
					const lastFreeze = freezes.length > 0 ? freezes[freezes.length - 1] : undefined
					if (lastFreeze && !lastFreeze.end && typeof previouslyScanned.format?.duration === 'number') {
						lastFreeze.end = previouslyScanned.format.duration
						lastFreeze.duration = previouslyScanned.format.duration - lastFreeze.start
					}

					resolve({
						scenes,
						freezes,
						blacks,
					})
				} else {
					reject(`FFProbe exited with code ${code} (${lastString})`)
				}
			}
		}
		ffMpegProcess.on('close', (code) => {
			onClose(code)
		})
		ffMpegProcess.on('exit', (code) => {
			onClose(code)
		})
	})
}
