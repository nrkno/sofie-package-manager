import { exec, ChildProcess, spawn } from 'child_process'
import { Accessor } from '@sofie-automation/blueprints-integration'
import { findBestPackageContainerWithAccess } from '../lib/lib'
import { GenericWorker } from '../../../worker'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	hashObj,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
} from '@shared/api'
import { isCorePackageInfoAccessorHandle, isLocalFolderHandle } from '../../../accessorHandlers/accessor'
import { IWorkInProgress, WorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainers, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { LocalFolderAccessorHandle } from '../../../accessorHandlers/localFolder'
import { scanWithFFProbe } from './mediaFileScan'

export const MediaFileDeepScan: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainers(genericWorker, {
			sources: exp.startRequirement.sources,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isMediaFileDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const accessSourcePackageContainer = findBestPackageContainerWithAccess(worker, exp.startRequirement.sources)

		const accessorTypeCost: { [key: string]: number } = {
			[Accessor.AccessType.LOCAL_FOLDER]: 1,
			[Accessor.AccessType.QUANTEL]: 1,
			[Accessor.AccessType.FILE_SHARE]: 2,
			[Accessor.AccessType.HTTP]: 3,
		}
		const sourceCost = accessSourcePackageContainer
			? 10 * accessorTypeCost[accessSourcePackageContainer.accessor.type as string] || 5
			: Number.POSITIVE_INFINITY

		return sourceCost
	},

	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isMediaFileDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready) return { ready: lookupSource.ready, reason: lookupSource.reason }
		const lookupTarget = await lookupDeepScanSources(worker, exp)
		if (!lookupTarget.ready) return { ready: lookupTarget.ready, reason: lookupTarget.reason }

		const issueReading = await lookupSource.handle.tryPackageRead()
		if (issueReading) return { ready: false, reason: issueReading }

		return {
			ready: true,
			reason: `${lookupSource.reason}, ${lookupTarget.reason}`,
		}
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isMediaFileDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready)
			return { fulfilled: false, reason: `Not able to access source: ${lookupSource.reason}` }
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready)
			return { fulfilled: false, reason: `Not able to access target: ${lookupTarget.reason}` }

		const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()

		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		const packageInfoSynced = await lookupTarget.handle.findUnUpdatedPackageInfo(
			'deepScan',
			exp,
			exp.startRequirement.content,
			actualSourceVersion,
			exp.endRequirement.version
		)
		if (packageInfoSynced.needsUpdate) {
			if (wasFullfilled) {
				// Remove the outdated scan result:
				await lookupTarget.handle.removePackageInfo('deepScan', exp)
			}
			return { fulfilled: false, reason: packageInfoSynced.reason }
		} else {
			return { fulfilled: true, reason: packageInfoSynced.reason }
		}
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isMediaFileDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Scan the source media file and upload the results to Core
		const startTime = Date.now()

		const lookupSource = await lookupDeepScanSources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason}`)

		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason}`)

		const currentProcess: {
			abort?: () => void
		} = {}
		const workInProgress = new WorkInProgress('Scanning file', async () => {
			// On cancel
			if (currentProcess.abort) {
				currentProcess.abort()
			}
		}).do(async () => {
			if (
				lookupSource.accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
				lookupTarget.accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO
			) {
				if (!isLocalFolderHandle(lookupSource.handle)) throw new Error(`Source AccessHandler type is wrong`)
				if (!isCorePackageInfoAccessorHandle(lookupTarget.handle))
					throw new Error(`Target AccessHandler type is wrong`)

				const targetHandle = lookupTarget.handle

				const issueReadPackage = await lookupSource.handle.checkPackageReadAccess()
				if (issueReadPackage) {
					workInProgress._reportError(new Error(issueReadPackage))
				} else {
					const actualSourceVersion = await lookupSource.handle.getPackageActualVersion()
					const sourceVersionHash = hashObj(actualSourceVersion)

					try {
						workInProgress._reportProgress(sourceVersionHash, 0.1)

						// Scan with FFProbe:
						const ffProbe = scanWithFFProbe(lookupSource.handle)
						currentProcess.abort = ffProbe.abort
						const ffProbeScan = await ffProbe.promise
						workInProgress._reportProgress(sourceVersionHash, 0.1)
						currentProcess.abort = undefined

						const deepScan: any = {}

						// Scan field order:
						const ffProbe2 = scanFieldOrder(lookupSource.handle, exp.endRequirement.version)
						currentProcess.abort = ffProbe2.abort
						deepScan.field_order = await ffProbe2.promise
						workInProgress._reportProgress(sourceVersionHash, 0.2)
						currentProcess.abort = undefined

						// Scan more info:
						const ffProbe3 = scanMoreInfo(
							lookupSource.handle,
							ffProbeScan,
							exp.endRequirement.version,
							(progress) => {
								workInProgress._reportProgress(sourceVersionHash, 0.2 + 0.79 * progress)
							}
						)
						currentProcess.abort = ffProbe3.abort
						const moreInfo = await ffProbe3.promise
						deepScan.blacks = moreInfo.blacks
						deepScan.freezes = moreInfo.freezes
						deepScan.scenes = moreInfo.scenes
						workInProgress._reportProgress(sourceVersionHash, 0.99)
						currentProcess.abort = undefined

						// all done:
						targetHandle
							.updatePackageInfo(
								'deepScan',
								exp,
								exp.startRequirement.content,
								actualSourceVersion,
								exp.endRequirement.version,
								deepScan
							)
							.then(
								() => {
									const duration = Date.now() - startTime
									workInProgress._reportComplete(
										sourceVersionHash,
										`Scan completed in ${Math.round(duration / 100) / 10}s`,
										undefined
									)
								},
								(err) => {
									workInProgress._reportError(err)
								}
							)
					} catch (err) {
						workInProgress._reportError(err)
					}
				}
			} else {
				throw new Error(
					`MediaFileScan.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
				)
			}
		})

		return workInProgress
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isMediaFileDeepScan(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		const lookupTarget = await lookupDeepScanTargets(worker, exp)
		if (!lookupTarget.ready) return { removed: false, reason: `Not able to access target: ${lookupTarget.reason}` }
		if (!isCorePackageInfoAccessorHandle(lookupTarget.handle)) throw new Error(`Target AccessHandler type is wrong`)

		await lookupTarget.handle.removePackageInfo('deepScan', exp)

		return { removed: true, reason: 'Removed scan info from Store' }
	},
}
function isMediaFileDeepScan(exp: Expectation.Any): exp is Expectation.MediaFileDeepScan {
	return exp.type === Expectation.Type.MEDIA_FILE_DEEP_SCAN
}
type Metadata = any // not used

function lookupDeepScanSources(
	worker: GenericWorker,
	exp: Expectation.MediaFileDeepScan
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(worker, exp.startRequirement.sources, exp.startRequirement.content, {
		read: true,
		readPackage: true,
		packageVersion: exp.startRequirement.version,
	})
}
function lookupDeepScanTargets(
	worker: GenericWorker,
	exp: Expectation.MediaFileDeepScan
): Promise<LookupPackageContainer<Metadata>> {
	return lookupAccessorHandles<Metadata>(worker, exp.endRequirement.targets, exp.endRequirement.content, {
		write: true,
		writePackageContainer: true,
	})
}

function scanFieldOrder(
	sourceHandle: LocalFolderAccessorHandle<any>,
	targetVersion: Expectation.MediaFileDeepScan['endRequirement']['version']
): { promise: Promise<FieldOrder>; abort: () => void } {
	if (!targetVersion.fieldOrder) {
		return {
			promise: Promise.resolve(FieldOrder.Unknown),
			abort: () => {
				// void
			},
		}
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
	// if (this.isQuantel(doc.mediaId)) {
	// 	const { result: qm, error: qmError } = await noTryAsync(() => this.getQuantelMonitor())
	// 	if (qmError) {
	// 		throw new Error(`Quantel media but no Quantel connection details for "${doc.mediaId}"`)
	// 	}
	// 	const { result: hlsUrl, error: urlError } = await noTryAsync(() => qm.toStreamUrl(doc.mediaId))
	// 	if (urlError) {
	// 		throw new Error(`Could not resolve Quantel ID to stream URL: ${urlError.message}`)
	// 	}
	// 	args.push('-seekable 0')
	// 	args.push(`-i "${hlsUrl}"`)
	// } else {
	args.push(`-i "${sourceHandle.fullPath}"`)
	// }

	let ffProbeProcess: ChildProcess | undefined = undefined

	const promise = new Promise<FieldOrder>((resolve, reject) => {
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
	return {
		promise,
		abort: () => {
			if (ffProbeProcess) {
				ffProbeProcess.kill() // todo: signal?
			}
		},
	}
}

function scanMoreInfo(
	sourceHandle: LocalFolderAccessorHandle<any>,
	previouslyScanned: any,
	targetVersion: Expectation.MediaFileDeepScan['endRequirement']['version'],
	onProgress: (progress: number) => void
): {
	promise: Promise<{
		scenes: number[]
		freezes: Anomaly[]
		blacks: Anomaly[]
	}>
	abort: () => void
} {
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
	// if (this.isQuantel(doc.mediaId)) {
	// 	const { result: qm, error: qmError } = await noTryAsync(() => this.getQuantelMonitor())
	// 	if (qmError) {
	// 		throw new Error(`Quantel media but no Quantel connection details for "${doc.mediaId}"`)
	// 	}
	// 	const { result: hlsUrl, error: urlError } = await noTryAsync(() => qm.toStreamUrl(doc.mediaId))
	// 	if (urlError) {
	// 		throw new Error(`Could not resolve Quantel ID to stream URL: ${urlError.message}`)
	// 	}
	// 	args.push('-seekable 0')
	// 	args.push(`-i "${hlsUrl}"`)
	// } else {
	args.push(`-i "${sourceHandle.fullPath}"`)
	// }
	args.push('-filter:v', filterString)
	args.push('-an')
	args.push('-f null')
	args.push('-threads 1')
	args.push('-')

	let ffProbeProcess: ChildProcess | undefined = undefined

	const promise = new Promise<{
		scenes: number[]
		freezes: Anomaly[]
		blacks: Anomaly[]
	}>((resolve, reject) => {
		ffProbeProcess = spawn(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', args, { shell: true })

		const scenes: number[] = []
		const freezes: Anomaly[] = []
		const blacks: Anomaly[] = []

		// TODO current frame is not read?
		// let currentFrame = 0

		// ffProbeProcess.stdout.on('data', () => { lastProgressReportTimestamp = new Date() })
		if (!ffProbeProcess.stderr) {
			throw new Error('spawned ffprobe-process stdin is null!')
		}
		let fileDuration: number | undefined = undefined
		ffProbeProcess.stderr.on('data', (data: any) => {
			const stringData = data.toString()

			if (typeof stringData !== 'string') return

			const frameRegex = /^frame= +\d+/g
			const timeRegex = /time=\s?(\d+):(\d+):([\d.]+)/
			const durationRegex = /Duration:\s?(\d+):(\d+):([\d.]+)/
			const sceneRegex = /Parsed_showinfo_(.*)pts_time:([\d.]+)\s+/g
			const blackDetectRegex = /(black_start:)(\d+(.\d+)?)( black_end:)(\d+(.\d+)?)( black_duration:)(\d+(.\d+))?/g
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
					freezes[i++].duration = parseFloat(res[2])
				}

				i = 0
				while ((res = freezeDetectEnd.exec(stringData)) !== null) {
					freezes[i++].end = parseFloat(res[2])
				}
			}
		})

		ffProbeProcess.on('close', (code) => {
			ffProbeProcess = undefined
			if (code === 0) {
				// success

				// If freeze frame is the end of video, it is not detected fully:
				if (
					freezes[freezes.length - 1] &&
					!freezes[freezes.length - 1].end &&
					typeof previouslyScanned.format?.duration === 'number'
				) {
					freezes[freezes.length - 1].end = previouslyScanned.format.duration
					freezes[freezes.length - 1].duration =
						previouslyScanned.format.duration - freezes[freezes.length - 1].start
				}

				resolve({
					scenes,
					freezes,
					blacks,
				})
			} else {
				reject(`Exited with code ${code}`)
			}
		})
	})
	return {
		promise,
		abort: () => {
			if (ffProbeProcess) {
				ffProbeProcess.kill() // todo: signal?
			}
		},
	}
}
enum FieldOrder {
	Unknown = 'unknown',
	Progressive = 'progressive',
	TFF = 'tff',
	BFF = 'bff',
}
interface Anomaly {
	start: number
	duration: number
	end: number
}
