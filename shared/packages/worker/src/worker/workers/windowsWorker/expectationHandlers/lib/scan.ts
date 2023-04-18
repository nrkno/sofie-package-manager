import { execFile, ChildProcess, spawn } from 'child_process'
import { Expectation, assertNever, Accessor, AccessorOnPackage } from '@sofie-package-manager/api'
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
import { FieldOrder, LoudnessScanResult, LoudnessScanResultForStream, ScanAnomaly } from './coreApi'
import { generateFFProbeFromClipData } from './quantelFormats'
import { FileShareAccessorHandle } from '../../../../accessorHandlers/fileShare'
import { HTTPProxyAccessorHandle } from '../../../../accessorHandlers/httpProxy'
import { HTTPAccessorHandle } from '../../../../accessorHandlers/http'
import { MAX_EXEC_BUFFER } from '../../../../lib/lib'
import { getFFMpegExecutable } from './ffmpeg'
import { GenericAccessorHandle } from '../../../../accessorHandlers/genericHandle'

export interface FFProbeScanResultStream {
	index: number
	codec_type: string
}

export interface FFProbeScanResult {
	filePath: string
	// to be defined...
	streams?: FFProbeScanResultStream[]
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
			const file = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
			// Use FFProbe to scan the file:
			const args = ['-hide_banner', `-i "${inputPath}"`, '-show_streams', '-show_format', '-print_format', 'json']
			let ffProbeProcess: ChildProcess | undefined = undefined
			onCancel(() => {
				ffProbeProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
				ffProbeProcess?.kill()
				reject('Cancelled')
			})

			ffProbeProcess = execFile(
				file,
				args,
				{
					maxBuffer: MAX_EXEC_BUFFER,
					windowsVerbatimArguments: true, // To fix an issue with ffprobe.exe on Windows
				},
				(err, stdout, _stderr) => {
					// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
					ffProbeProcess = undefined
					if (err) {
						reject(err)
						return
					}
					const json: FFProbeScanResult = JSON.parse(stdout)
					if (!json.streams || !json.streams[0]) {
						reject(new Error(`File doesn't seem to be a media file`))
						return
					}
					json.filePath = filePath

					fixJSONResult(json)
					resolve(json)
				}
			)
		} else if (isQuantelClipAccessorHandle(sourceHandle)) {
			// Because we have no good way of using ffprobe to generate the into we want,
			// we resort to faking it:

			const clip = await sourceHandle.getClip()
			if (!clip) throw new Error('Source not found')

			const clipDetails = await sourceHandle.getClipDetails(clip.ClipID)
			if (!clipDetails) throw new Error(`Source clip details not found`)

			const scanResult = generateFFProbeFromClipData(clipDetails)

			fixJSONResult(scanResult)
			resolve(scanResult)
		} else {
			assertNever(sourceHandle)
		}
	})
}

/**
 * Change "." to "_" in keys.
 * This is due to "." not being supported in some databases.
 */
function fixJSONResult(obj: FFProbeScanResult): void
function fixJSONResult(obj: any): void {
	if (Array.isArray(obj)) {
		for (const value of obj) {
			fixJSONResult(value)
		}
	} else if (obj && typeof obj === 'object') {
		for (const key of Object.keys(obj)) {
			fixJSONResult(obj[key])

			if (key.indexOf('.') !== -1) {
				const fixedKey = key.replace(/\./g, '_')
				obj[fixedKey] = obj[key]
				delete obj[key]
			}
		}
	} else {
		// do nothing
	}
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

		const file = getFFMpegExecutable()
		const args = [
			'-hide_banner',
			'-filter:v idet',
			`-frames:v ${targetVersion.fieldOrderScanDuration || 200}`,
			'-an',
			'-f',
			'rawvideo',
			'-y',
			process.platform === 'win32' ? 'NUL' : '/dev/null',
		]

		args.push(...(await getFFMpegInputArgsFromAccessorHandle(sourceHandle)))

		let ffmpegProcess: ChildProcess | undefined = undefined
		onCancel(() => {
			ffmpegProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
			ffmpegProcess?.kill()
			reject('Cancelled')
		})

		ffmpegProcess = execFile(
			file,
			args,
			{
				maxBuffer: MAX_EXEC_BUFFER,
				windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
			},
			(err, _stdout, stderr) => {
				// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
				ffmpegProcess = undefined
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
			}
		)
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
				`blackdetect=d=${targetVersion.blackDuration || '0.2'}:` +
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

		args.push(...(await getFFMpegInputArgsFromAccessorHandle(sourceHandle)))

		args.push('-filter:v', filterString)
		args.push('-an')
		args.push('-f null')
		args.push('-threads 1')
		args.push('-')

		let ffMpegProcess: ChildProcess | undefined = undefined

		const killFFMpeg = () => {
			// ensure this function doesn't throw, since it is called from various error event handlers
			try {
				ffMpegProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
				ffMpegProcess?.kill()
			} catch (e) {
				// This is probably OK, errors likely means that the process is already dead
			}
		}
		onCancel(() => {
			killFFMpeg()
			reject('Cancelled')
		})

		ffMpegProcess = spawn(getFFMpegExecutable(), args, {
			windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
		})

		const scenes: number[] = []
		let freezes: ScanAnomaly[] = []
		let blacks: ScanAnomaly[] = []

		// TODO current frame is not read?
		// let currentFrame = 0

		// ffProbeProcess.stdout.on('data', () => { lastProgressReportTimestamp = new Date() })
		if (!ffMpegProcess.stderr) {
			throw new Error('spawned ffprobe-process stdin is null!')
		}
		let previousStringData = ''
		let fileDuration: number | undefined = undefined
		ffMpegProcess.stderr.on('data', (data: any) => {
			const stringData = data.toString()

			if (typeof stringData !== 'string') return

			try {
				const frameRegex = /^frame= +\d+/g
				const timeRegex = /time=\s?(\d+):(\d+):([\d.]+)/
				const durationRegex = /Duration:\s?(\d+):(\d+):([\d.]+)/
				const sceneRegex = /Parsed_showinfo_(.*)pts_time:([\d.]+)\s+/g
				const blackDetectRegex =
					/(black_start:)(\d+(.\d+)?)( black_end:)(\d+(.\d+)?)( black_duration:)(\d+(.\d+)?)/g
				const freezeDetectStart = /(lavfi\.freezedetect\.freeze_start: )(\d+(.\d+)?)/g
				const freezeDetectDuration = /(lavfi\.freezedetect\.freeze_duration: )(\d+(.\d+)?)/g
				const freezeDetectEnd = /(lavfi\.freezedetect\.freeze_end: )(\d+(.\d+)?)/g

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
						const freeze = freezes[i++]
						if (freeze) freeze.duration = parseFloat(res[2])
					}

					i = 0
					while ((res = freezeDetectEnd.exec(stringData)) !== null) {
						const freeze = freezes[i++]
						if (freeze) freeze.end = parseFloat(res[2])
					}
				}
				previousStringData = stringData
			} catch (err) {
				if (err && typeof err === 'object') {
					// If there was an error parsing the output, we should also provide the string we tried to parse:
					onError(err, previousStringData + '\r\n' + stringData)
				} else {
					onError(err, undefined)
				}
				throw err
			}
		})

		freezes = freezes.filter((freeze) => freeze.duration > 0)
		blacks = blacks.filter((black) => black.duration > 0)

		const onError = (err: unknown, context: string | undefined) => {
			if (ffMpegProcess) {
				killFFMpeg()

				reject(
					`Error parsing FFProbe data. Error: "${err} ${
						err && typeof err === 'object' ? (err as Error).stack : ''
					}", context: "${context}" `
				)
			}
		}

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
					reject(`FFProbe exited with code ${code} (${previousStringData})`)
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

function scanLoudnessStream(
	sourceHandle:
		| LocalFolderAccessorHandle<any>
		| FileShareAccessorHandle<any>
		| HTTPAccessorHandle<any>
		| HTTPProxyAccessorHandle<any>
		| QuantelAccessorHandle<any>,
	_previouslyScanned: FFProbeScanResult,
	channelSpec: string
): CancelablePromise<LoudnessScanResultForStream> {
	return new CancelablePromise<LoudnessScanResultForStream>(async (resolve, reject, onCancel) => {
		const stereoPairMatch = channelSpec.match(/^(\d+)\+(\d+)$/)
		const singleChannel = Number.parseInt(channelSpec)
		if (!stereoPairMatch && !Number.isInteger(singleChannel)) {
			reject(`Invalid channel specification: ${channelSpec}`)
			return
		}

		let filterString: string

		if (stereoPairMatch) {
			filterString = `[0:a:${stereoPairMatch[1]}][0:a:${stereoPairMatch[2]}]join=inputs=2:channel_layout=stereo,ebur128=peak=true[out]`
		} else {
			filterString = `[0:a:${singleChannel}]ebur128=peak=true[out]`
		}

		const file = getFFMpegExecutable()
		const args = [
			'-nostats',
			'-filter_complex',
			JSON.stringify(filterString),
			'-map',
			JSON.stringify('[out]'),
			'-f',
			'null',
			'-',
		]

		args.push(...(await getFFMpegInputArgsFromAccessorHandle(sourceHandle)))

		let ffmpegProcess: ChildProcess | undefined = undefined
		onCancel(() => {
			ffmpegProcess?.stdin?.write('q') // send "q" to quit, because .kill() doesn't quite do it.
			ffmpegProcess?.kill()
			reject('Cancelled')
		})

		ffmpegProcess = execFile(
			file,
			args,
			{
				maxBuffer: MAX_EXEC_BUFFER,
				windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
			},
			(err, _stdout, stderr) => {
				// this.logger.debug(`Worker: metadata generate: output (stdout, stderr)`, stdout, stderr)
				ffmpegProcess = undefined
				if (err) {
					reject(err)
					return
				}

				const StreamNotFoundRegex = /Stream specifier [\S\s]+ matches no streams./

				const LayoutRegex = /Output #0, null[\S\s]+Stream #0:0: Audio: [\w]+, [\d]+ Hz, (?<layout>\w+),/

				const LoudnessRegex =
					/Integrated loudness:\s+I:\s+(?<integrated>[\d-.,]+)\s+LUFS\s+Threshold:\s+(?<threshold>[\d-.,]+)\s+LUFS\s+Loudness range:\s+LRA:\s+(?<lra>[\d-.,]+)\s+LU\s+Threshold:\s+(?<rangeThreshold>[\d-.,]+)\s+LUFS\s+LRA low:\s+(?<lraLow>[\d-.,]+)\s+LUFS\s+LRA high:\s+(?<lraHigh>[\d-.,]+)\s+LUFS\s+True peak:\s+Peak:\s+(?<truePeak>[\d-.,]+)\s+dBFS\s*$/i

				const loudnessRes = LoudnessRegex.exec(stderr)
				const layoutRes = LayoutRegex.exec(stderr)
				const streamNotFound = StreamNotFoundRegex.exec(stderr)

				if (streamNotFound) {
					return resolve({
						success: false,
						reason: 'Specified Audio stream not found',
					})
				}

				if (loudnessRes === null) {
					reject(`ffmpeg output unreadable`)
				} else {
					resolve({
						success: true,
						layout: layoutRes?.groups?.['layout'] ?? 'unknown',
						integrated: Number.parseFloat(loudnessRes.groups?.['integrated'] ?? ''),
						integratedThreshold: Number.parseFloat(loudnessRes.groups?.['threshold'] ?? ''),
						range: Number.parseFloat(loudnessRes.groups?.['lra'] ?? ''),
						rangeThreshold: Number.parseFloat(loudnessRes.groups?.['rangeThreshold'] ?? ''),
						rangeHigh: Number.parseFloat(loudnessRes.groups?.['lraHigh'] ?? ''),
						rangeLow: Number.parseFloat(loudnessRes.groups?.['lraLow'] ?? ''),
						truePeak: Number.parseFloat(loudnessRes.groups?.['truePeak'] ?? ''),
					})
				}
			}
		)
	})
}

export function scanLoudness(
	sourceHandle:
		| LocalFolderAccessorHandle<any>
		| FileShareAccessorHandle<any>
		| HTTPAccessorHandle<any>
		| HTTPProxyAccessorHandle<any>
		| QuantelAccessorHandle<any>,
	previouslyScanned: FFProbeScanResult,
	targetVersion: Expectation.PackageLoudnessScan['endRequirement']['version'],
	/** Callback which is called when there is some new progress */
	onProgress: (
		/** Progress, goes from 0 to 1 */
		progress: number
	) => void
): CancelablePromise<LoudnessScanResult> {
	return new CancelablePromise<LoudnessScanResult>(async (resolve, _reject, onCancel) => {
		if (!targetVersion.channels.length) {
			resolve({
				channels: {},
			})
			return
		}

		const step = 1 / targetVersion.channels.length

		let progress = 0

		const packageScanResult: Record<string, LoudnessScanResultForStream> = {}

		for (const channelSpec of targetVersion.channels) {
			try {
				const resultPromise = scanLoudnessStream(sourceHandle, previouslyScanned, channelSpec)
				onCancel(() => {
					resultPromise.cancel()
				})
				const result = await resultPromise
				packageScanResult[channelSpec] = result
			} catch (e) {
				packageScanResult[channelSpec] = {
					success: false,
					reason: String(e),
				}
			}
			progress += step
			onProgress(progress)
		}

		resolve({
			channels: packageScanResult,
		})
	})
}

async function getFFMpegInputArgsFromAccessorHandle(
	sourceHandle:
		| LocalFolderAccessorHandle<any>
		| FileShareAccessorHandle<any>
		| HTTPAccessorHandle<any>
		| HTTPProxyAccessorHandle<any>
		| QuantelAccessorHandle<any>
): Promise<string[]> {
	const args: string[] = []
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

	return args
}

const FFMPEG_SUPPORTED_SOURCE_ACCESSORS: Set<Accessor.AccessType | undefined> = new Set([
	Accessor.AccessType.LOCAL_FOLDER,
	Accessor.AccessType.FILE_SHARE,
	Accessor.AccessType.HTTP,
	Accessor.AccessType.HTTP_PROXY,
	Accessor.AccessType.QUANTEL,
])

export function isAnFFMpegSupportedSourceAccessor(sourceAccessorOnPackage: AccessorOnPackage.Any): boolean {
	return FFMPEG_SUPPORTED_SOURCE_ACCESSORS.has(sourceAccessorOnPackage.type)
}

export function isAnFFMpegSupportedSourceAccessorHandle(
	sourceHandle: GenericAccessorHandle<any>
): sourceHandle is
	| LocalFolderAccessorHandle<any>
	| FileShareAccessorHandle<any>
	| HTTPAccessorHandle<any>
	| HTTPProxyAccessorHandle<any>
	| QuantelAccessorHandle<any> {
	return (
		isLocalFolderAccessorHandle(sourceHandle) ||
		isFileShareAccessorHandle(sourceHandle) ||
		isHTTPAccessorHandle(sourceHandle) ||
		isHTTPProxyAccessorHandle(sourceHandle) ||
		isQuantelClipAccessorHandle(sourceHandle)
	)
}
