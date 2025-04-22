import {
	GenericAccessorHandle,
	PackageReadInfo,
	PackageReadStream,
	PutPackageHandler,
	SetupPackageContainerMonitorsResult,
	AccessorHandlerCheckHandleReadResult,
	AccessorHandlerCheckHandleWriteResult,
	AccessorHandlerCheckPackageContainerWriteAccessResult,
	AccessorHandlerCheckPackageReadAccessResult,
	AccessorHandlerTryPackageReadResult,
	AccessorHandlerRunCronJobResult,
	PackageOperation,
	AccessorHandlerCheckHandleBasicResult,
	AccessorConstructorProps,
} from './genericHandle'
import { Expectation, Accessor, AccessorOnPackage, escapeFilePath } from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { Atem, AtemConnectionStatus, Util as AtemUtil } from 'atem-connection'
import { ClipBank } from 'atem-connection/dist/state/media'
import * as crypto from 'crypto'
import { execFile } from 'child_process'
import tmp from 'tmp'
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { UniversalVersion } from '../workers/genericWorker/lib/lib'
import { MAX_EXEC_BUFFER } from '../lib/lib'
import { defaultCheckHandleRead, defaultCheckHandleWrite } from './lib/lib'
import { getFFMpegExecutable, getFFProbeExecutable } from '../workers/genericWorker/expectationHandlers/lib/ffmpeg'

const fsReadFile = promisify(fs.readFile)

/** Accessor handle for accessing files on an ATEM */
export class ATEMAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'atem'
	private content: {
		/** This is set when the class-instance is only going to be used for PackageContainer access.*/
		onlyContainerAccess?: boolean
		filePath?: string
	}
	private accessor: AccessorOnPackage.AtemMediaStore

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.AtemMediaStore>) {
		super({
			...arg,
			type: ATEMAccessorHandle.type,
		})

		this.accessor = arg.accessor
		this.content = arg.content

		// Verify content data:
		if (!this.content.onlyContainerAccess) {
			if (!this._getFilePath())
				throw new Error('Bad input data: neither content.filePath nor accessor.filePath are set!')
		}
	}
	static doYouSupportAccess(worker: BaseWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.AtemMediaStore
		return !accessor.networkId || worker.agentAPI.location.localNetworkIds.includes(accessor.networkId)
	}
	get packageName(): string {
		return this.getAtemClipName()
	}
	private async getAtem(): Promise<Atem> {
		if (!this.worker.accessorCache['atem']) {
			const atem = new Atem()
			this.worker.accessorCache['atem'] = atem

			if (!this.accessor.atemHost) {
				throw new Error('Bad input data: accessor.atemHost not set!')
			}

			await atem.connect(this.accessor.atemHost)
		}
		return this.worker.accessorCache['atem'] as Atem
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.ATEM_MEDIA_STORE) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `ATEM Accessor type is not ATEM ("${this.accessor.type}")!`,
				},
			}
		}
		if (!this.accessor.mediaType) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Accessor mediaType not set`,
					tech: `Accessor mediaType not set`,
				},
			}
		}
		if (typeof this.accessor.bankIndex !== 'number') {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Accessor bankIndex not set`,
					tech: `Accessor bankIndex not set`,
				},
			}
		}
		return { success: true }
	}
	checkHandleRead(): AccessorHandlerCheckHandleReadResult {
		const defaultResult = defaultCheckHandleRead(this.accessor)
		if (defaultResult) return defaultResult
		return { success: true }
	}
	checkHandleWrite(): AccessorHandlerCheckHandleWriteResult {
		const defaultResult = defaultCheckHandleWrite(this.accessor)
		if (defaultResult) return defaultResult
		return { success: true }
	}
	async checkPackageReadAccess(): Promise<AccessorHandlerCheckPackageReadAccessResult> {
		// Check if the package exists:
		const atem = await this.getAtem()
		if (!atem.state) {
			throw new Error('ATEM state not available')
		}

		const mediaType = this.accessor.mediaType
		if (!mediaType) {
			throw new Error('mediaType is undefined')
		}

		const bankIndex = this.accessor.bankIndex
		if (typeof bankIndex !== 'number') {
			throw new Error('bankIndex is undefined')
		}

		if (mediaType === 'clip') {
			if (atem.state.media.clipPool[bankIndex]?.name === this.getAtemClipName()) {
				return {
					success: true,
				}
			}
		}

		// Reading actually not supported, but oh well..
		return {
			success: false,
			knownReason: true,
			reason: {
				user: 'Clip not found',
				tech: `Clip "${this.getAtemClipName()}" not found`,
			},
		}
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		const atem = await this.getAtem()
		if (!atem.state?.media.clipPool || !atem.state?.media.stillPool) {
			return {
				success: false,
				knownReason: true,
				packageExists: false,
				reason: {
					user: `ATEM media pools are inaccessible`,
					tech: `ATEM media pools are inaccessible`,
				},
			}
		}

		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		const atem = await this.getAtem()
		if (atem.status === AtemConnectionStatus.CONNECTED && atem.state) {
			return { success: true }
		}

		return new Promise((resolve) => {
			const successHandler = () => {
				resolve({ success: true })
				removeListeners()
			}

			const errorHandler = (error: string) => {
				resolve({
					success: false,
					knownReason: false,
					reason: {
						user: `Error connecting to ATEM`,
						tech: error,
					},
				})
				removeListeners()
			}

			const removeListeners = () => {
				atem.off('connected', successHandler)
				atem.off('error', errorHandler)
			}

			atem.once('connected', successHandler)
			atem.once('error', errorHandler)
		})
	}
	async getPackageActualVersion(): Promise<Expectation.Version.ATEMFile> {
		const atem = await this.getAtem()
		if (!atem.state) {
			throw new Error('ATEM state not available')
		}

		const mediaType = this.accessor.mediaType
		if (!mediaType) {
			throw new Error('mediaType is undefined')
		}

		const bankIndex = this.accessor.bankIndex
		if (typeof bankIndex !== 'number') {
			throw new Error('bankIndex is undefined')
		}

		if (mediaType === 'clip') {
			const clip = atem.state.media.clipPool[bankIndex]
			if (!clip) {
				throw new Error('ATEM clip not available')
			}

			return {
				type: Expectation.Version.Type.ATEM_FILE,
				frameCount: clip.frameCount,
				name: clip.name,
				hash: this.getClipHash(clip),
			}
		} else {
			const still = atem.state.media.stillPool[bankIndex]
			if (!still) {
				throw new Error('ATEM still not available')
			}

			return {
				type: Expectation.Version.Type.ATEM_FILE,
				frameCount: 1,
				name: still.fileName,
				hash: still.hash,
			}
		}
	}
	async removePackage(reason: string): Promise<void> {
		const atem = await this.getAtem()
		if (this.accessor.mediaType && typeof this.accessor.bankIndex === 'number') {
			if (this.accessor.mediaType === 'clip') {
				await atem.clearMediaPoolClip(this.accessor.bankIndex)
				this.logOperation(`Remove package: Removed clip "${this.packageName}" (${reason})`)
			} else {
				await atem.clearMediaPoolStill(this.accessor.bankIndex)
				this.logOperation(`Remove package: Removed still "${this.packageName}" (${reason})`)
			}
		} else {
			throw new Error('mediaType or bankIndex were undefined')
		}
	}
	async getPackageReadStream(): Promise<PackageReadStream> {
		throw new Error('ATEM.getPackageReadStream: Not supported')
	}
	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		const bankIndex = this.accessor.bankIndex
		if (typeof bankIndex !== 'number') {
			throw new Error('bankIndex is undefined')
		}
		let aborted = false

		const streamWrapper: PutPackageHandler = new PutPackageHandler(() => {
			// can't really abort the write stream
			aborted = true
		})
		streamWrapper.usingCustomProgressEvent = true

		setImmediate(() => {
			Promise.resolve()
				.then(async () => {
					const atem = await this.getAtem()
					if (!atem.state || !atem.state.settings.mediaPool) {
						throw new Error('atem-connection not ready')
					}

					streamWrapper.emit('progress', 0.1)

					const tmpObj = tmp.dirSync({ unsafeCleanup: true })
					try {
						const inputFile = path.join(tmpObj.name, 'input')
						const info = AtemUtil.getVideoModeInfo(atem.state.settings.videoMode)
						if (!info) {
							throw new Error('ATEM is running at an unknown video mode')
						}
						const { width, height } = info
						await stream2Disk(sourceStream, inputFile)
						if (aborted) return
						streamWrapper.emit('progress', 0.2)

						if (this.accessor.mediaType === 'still') {
							await createTGASequence(inputFile, { width, height })
							if (aborted) return
							streamWrapper.emit('progress', 0.5)

							const allTGAs = fs
								.readdirSync(tmpObj.name)
								.filter((filename) => {
									return filename.endsWith('.tga')
								})
								.map((tga) => {
									return path.join(tmpObj.name, tga)
								})

							if (allTGAs.length > 1) {
								throw new Error('found more TGA files in temp dir than expected')
							}

							const tgaPath = allTGAs[0]
							await convertFrameToRGBA(tgaPath)
							if (aborted) return
							streamWrapper.emit('progress', 0.7)

							const rgbaPath = tgaPath.replace('.tga', '.rgba')
							const rgbaBuffer = await fsReadFile(rgbaPath)
							if (aborted) return
							await atem.uploadStill(
								bankIndex,
								rgbaBuffer,
								this.getAtemClipName(),
								'Uploaded by package-manager'
							)
							streamWrapper.emit('progress', 1)
						} else {
							const duration = await countFrames(inputFile)
							if (aborted) return
							const maxDuration = atem.state.settings.mediaPool.maxFrames[bankIndex]
							if (duration > maxDuration) {
								throw new Error(`File is too long in duration (${duration} frames, max ${maxDuration})`)
							}

							streamWrapper.emit('progress', 0.3)
							await createTGASequence(inputFile, { width, height })
							if (aborted) return
							streamWrapper.emit('progress', 0.4)

							const allTGAs = fs
								.readdirSync(tmpObj.name)
								.filter((filename) => {
									return filename.endsWith('.tga')
								})
								.map((tga) => {
									return path.join(tmpObj.name, tga)
								})

							streamWrapper.emit('progress', 0.5)
							for (let index = 0; index < allTGAs.length; index++) {
								const tga = allTGAs[index]
								streamWrapper.emit('progress', 0.5 + 0.1 * (index / allTGAs.length))
								await convertFrameToRGBA(tga)
								if (aborted) return
							}
							streamWrapper.emit('progress', 0.6)

							const allRGBAs = allTGAs.map((filename) => {
								return filename.replace('.tga', '.rgba')
							})
							const provideFrame = async function* (): AsyncGenerator<Buffer> {
								for (let i = 0; i < allRGBAs.length; i++) {
									if (aborted) throw new Error('Aborted')

									streamWrapper.emit('progress', 0.61 + 0.29 * ((i - 0.5) / allRGBAs.length))
									yield await fsReadFile(allRGBAs[i])
									streamWrapper.emit('progress', 0.61 + 0.29 * (i / allRGBAs.length))
								}
							}

							try {
								await atem.uploadClip(bankIndex, provideFrame(), this.getAtemClipName())
							} catch (e) {
								if (`${e}`.match(/Aborted/)) {
									return
								} else throw e
							}
							if (aborted) return

							const audioStreamIndices = await getStreamIndices(inputFile, 'audio')
							if (audioStreamIndices.length > 0) {
								await convertAudio(inputFile)
								await sleep(1000) // Helps avoid a lock-related "Code 5" error from the ATEM.

								if (aborted) return
								const audioBuffer = await fsReadFile(replaceFileExtension(inputFile, '.wav'))
								await atem.uploadAudio(bankIndex, audioBuffer, `audio${this.accessor.bankIndex}`)
							}

							streamWrapper.emit('progress', 1)
						}
					} catch (err) {
						streamWrapper.emit('error', err)
					} finally {
						tmpObj.removeCallback()
					}

					streamWrapper.emit('close')
				})
				.catch((err) => {
					streamWrapper.emit('error', err)
				})
		})

		return streamWrapper
	}
	private getAtemClipName(): string {
		const filePath = this._getFilePath()

		if (!filePath) throw new Error('Atem: filePath not set!')
		return filePath
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('ATEM.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		throw new Error('ATEM.putPackageInfo: Not supported')
	}
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		// do nothing
		return this.logWorkOperation(operationName, source, this.packageName)
	}
	async finalizePackage(operation: PackageOperation): Promise<void> {
		// do nothing
		operation.logDone()
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		return {
			fileSize: { name: 'fileSize', value: undefined, omit: true },
			modified: { name: 'modified', value: undefined, omit: true },
			etags: { name: 'etags', value: undefined, omit: true },
			contentType: { name: 'contentType', value: undefined, omit: true },
		} as UniversalVersion as any as Metadata
	}
	async updateMetadata(_metadata: Metadata): Promise<void> {
		// Not supported
	}
	async removeMetadata(): Promise<void> {
		// Not supported
	}
	async runCronJob(): Promise<AccessorHandlerRunCronJobResult> {
		return {
			success: true,
		} // not applicable
	}
	async setupPackageContainerMonitors(): Promise<SetupPackageContainerMonitorsResult> {
		return {
			success: false,
			knownReason: false,
			reason: {
				user: `There is an internal issue in Package Manager`,
				tech: 'setupPackageContainerMonitors, not supported',
			},
		} // not applicable
	}

	/** Computes an ATEM clip hash by concatenating the hashes for all the individual frames
	 * then hashing that.
	 */
	private getClipHash(clip: ClipBank): string {
		const concatenatedHash = clip.frames.reduce((previousValue, frame) => {
			if (!frame) {
				return previousValue
			}

			return previousValue + frame.hash
		}, '')

		return crypto.createHash('md5').update(concatenatedHash).digest('base64')
	}
	private _getFilePath(): string | undefined {
		return this.accessor.filePath || this.content.filePath
	}
}

async function stream2Disk(sourceStream: NodeJS.ReadableStream, outputFile: string): Promise<void> {
	let handled = false
	return new Promise((resolve, reject) => {
		const writeStream = fs.createWriteStream(outputFile)
		sourceStream.pipe(writeStream)
		sourceStream.on('error', (error) => {
			if (handled) {
				return
			}
			handled = true
			writeStream.end()
			reject(error)
		})
		writeStream.on('error', (error) => {
			if (handled) {
				return
			}
			handled = true
			writeStream.end()
			reject(error)
		})
		writeStream.on('finish', () => {
			if (handled) {
				return
			}
			handled = true
			writeStream.end()
			resolve()
		})
	})
}

export async function createTGASequence(inputFile: string, opts?: { width: number; height: number }): Promise<string> {
	const outputFile = replaceFileExtension(inputFile, '_%04d.tga')
	const args = ['-i', escapeFilePath(inputFile)]
	if (opts) {
		args.push('-vf', `scale=${opts.width}:${opts.height}`)
	}
	args.push(escapeFilePath(outputFile))

	return ffmpeg(args)
}

export async function convertFrameToRGBA(inputFile: string): Promise<string> {
	const outputFile = replaceFileExtension(inputFile, '.rgba')
	const args = [`-i`, escapeFilePath(inputFile), '-pix_fmt', 'rgba', '-f', 'rawvideo', outputFile]
	return ffmpeg(args)
}

export async function convertAudio(inputFile: string): Promise<string> {
	const outputFile = replaceFileExtension(inputFile, '.wav')
	const args = [
		`-i`,
		escapeFilePath(inputFile),
		'-vn', // no video
		'-ar',
		'48000', // 48kHz sample rate
		'-ac',
		'2', // stereo audio
		'-c:a',
		'pcm_s24le',
		escapeFilePath(outputFile),
	]

	return ffmpeg(args)
}

export async function countFrames(inputFile: string): Promise<number> {
	const args = [
		'-i',
		escapeFilePath(inputFile),
		'-v',
		'error',
		'-select_streams',
		'v:0',
		'-count_frames',
		'-show_entries',
		'stream=nb_read_frames',
		'-print_format',
		'csv',
	]

	const result = await ffprobe(args)

	const resultParts = result.split(',')
	return parseInt(resultParts[1], 10)
}

export async function getStreamIndices(inputFile: string, type: 'video' | 'audio'): Promise<number[]> {
	const args = [
		'-i',
		escapeFilePath(inputFile),
		'-v',
		'error',
		'-select_streams',
		type === 'video' ? 'v' : 'a',
		'-show_entries',
		'stream=index',
		'-of',
		'csv=p=0',
	]

	const result = await ffprobe(args)

	const resultParts = result
		.split('\n')
		.map((str) => parseInt(str, 10))
		.filter((num) => !isNaN(num))

	return resultParts
}

async function ffprobe(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const file = getFFProbeExecutable()
		execFile(
			file,
			args,
			{
				maxBuffer: MAX_EXEC_BUFFER,
				windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
			},
			(error, stdout) => {
				if (error) {
					reject(error)
				} else {
					resolve(stdout)
				}
			}
		)
	})
}

async function ffmpeg(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const file = getFFMpegExecutable()
		execFile(
			file,
			['-v', 'error', ...args],
			{
				maxBuffer: MAX_EXEC_BUFFER,
				windowsVerbatimArguments: true, // To fix an issue with ffmpeg.exe on Windows
			},
			(error, stdout) => {
				if (error) {
					reject(error)
				} else {
					resolve(stdout)
				}
			}
		)
	})
}

function replaceFileExtension(inputFile: string, newExt: string): string {
	let outputFile = inputFile.replace(/\..+$/i, newExt)

	// Handle files with no extension
	if (!outputFile.endsWith(newExt)) {
		outputFile = outputFile + newExt
	}

	return outputFile
}

async function sleep(duration: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(), duration)
	})
}
