import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import mime from 'mime-types'
import prettyBytes from 'pretty-bytes'
import { asyncPipe, CTX, CTXPost } from '../lib'
import { HTTPServerConfig, LoggerInstance } from '@sofie-package-manager/api'
import { BadResponse, PackageInfo, Storage } from './storage'
import { Readable } from 'stream'

// Note: Explicit types here, due to that for some strange reason, promisify wont pass through the correct typings.
const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)
const fsRmDir = promisify(fs.rmdir)
const fsReaddir = promisify(fs.readdir)
const fsLstat = promisify(fs.lstat)
const fsWriteFile = promisify(fs.writeFile)
const fsMkDir = promisify(fs.mkdir)

type FileInfo = {
	found: true
	fullPath: string
	mimeType: string
	length: number
	lastModified: Date
}

export class FileStorage extends Storage {
	private _basePath: string
	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private config: HTTPServerConfig) {
		super()
		this._basePath = path.resolve(this.config.httpServer.basePath)
		this.logger = logger.category('FileStorage')

		// Run this on startup, so that if there are any critical errors we'll see them right away:
		this.cleanupOldFiles().catch(this.logger.error)
	}

	getInfo(): string {
		return `basePath: "${this._basePath}", cleanFileAge: ${this.config.httpServer.cleanFileAge}`
	}

	async init(): Promise<void> {
		await fsMkDir(this._basePath, { recursive: true })
	}

	async listPackages(ctx: CTX): Promise<{ packages: PackageInfo[] } | BadResponse> {
		const packages: PackageInfo[] = []

		const getAllFiles = async (basePath: string, dirPath: string) => {
			const files = await fsReaddir(path.join(basePath, dirPath))

			await Promise.all(
				files.map(async (fileName) => {
					const displayPath = path.join(dirPath, fileName)
					const fullPath = path.join(basePath, dirPath, fileName)

					const lStat = await fsLstat(fullPath)
					if (lStat.isDirectory()) {
						await getAllFiles(basePath, displayPath)
					} else {
						packages.push({
							path: displayPath.replace(/\\/g, '/'),
							size: prettyBytes(lStat.size),
							modified: new Date(lStat.mtimeMs).toISOString(),
						})
					}
				})
			)
		}

		await getAllFiles(this._basePath, '')

		packages.sort((a, b) => {
			if (a.path > b.path) return 1
			if (a.path < b.path) return -1
			return 0
		})

		ctx.body = { packages }
		return { packages }
	}
	private async getFileInfo(paramPath: string): Promise<
		| {
				found: false
		  }
		| ({
				found: true
		  } & FileInfo)
	> {
		const fullPath = path.join(this._basePath, paramPath)

		if (!(await this.exists(fullPath))) {
			return { found: false }
		}
		let mimeType = mime.lookup(fullPath)
		if (!mimeType) {
			// Fallback to "unknown binary":
			mimeType = 'application/octet-stream'
			// return { code: 501, reason: 'Unknown / unsupported file format' }
		}

		const stat = await fsStat(fullPath)

		return {
			found: true,
			fullPath,
			mimeType,
			length: stat.size,
			lastModified: stat.mtime,
		}
	}
	async headPackage(paramPath: string, ctx: CTX): Promise<true | BadResponse> {
		const fileInfo = await this.getFileInfo(paramPath)

		if (!fileInfo.found) {
			return { code: 404, reason: 'Package not found' }
		}

		this.setHeaders(fileInfo, ctx)

		ctx.response.status = 204

		ctx.body = undefined

		return true
	}
	async getPackage(paramPath: string, ctx: CTX): Promise<true | BadResponse> {
		const fileInfo = await this.getFileInfo(paramPath)

		if (!fileInfo.found) {
			return { code: 404, reason: 'Package not found' }
		}

		this.setHeaders(fileInfo, ctx)

		const readStream = fs.createReadStream(fileInfo.fullPath)
		ctx.body = readStream

		return true
	}
	async postPackage(
		paramPath: string,
		ctx: CTXPost,
		fileStreamOrText: string | Readable | undefined
	): Promise<true | BadResponse> {
		const fullPath = path.join(this._basePath, paramPath)

		await fsMkDir(path.dirname(fullPath), { recursive: true })

		const exists = await this.exists(fullPath)
		if (exists) await fsUnlink(fullPath)

		let plainText = (ctx.request.body as { text: string | undefined })?.text
		if (!plainText && typeof fileStreamOrText === 'string') {
			plainText = fileStreamOrText
		}

		if (plainText) {
			// store plain text into file
			await fsWriteFile(fullPath, plainText)

			ctx.body = { code: 201, message: `${exists ? 'Updated' : 'Inserted'} "${paramPath}"` }
			ctx.response.status = 201
			return true
		} else if (fileStreamOrText && typeof fileStreamOrText !== 'string') {
			const fileStream = fileStreamOrText
			await asyncPipe(fileStream, fs.createWriteStream(fullPath))

			ctx.body = { code: 201, message: `${exists ? 'Updated' : 'Inserted'} "${paramPath}"` }
			ctx.response.status = 201
			return true
		} else {
			return { code: 400, reason: 'No files provided' }
		}
	}
	async deletePackage(paramPath: string, ctx: CTXPost): Promise<true | BadResponse> {
		const fullPath = path.join(this._basePath, paramPath)

		if (!(await this.exists(fullPath))) {
			return { code: 404, reason: 'Package not found' }
		}

		await fsUnlink(fullPath)

		ctx.body = { message: `Deleted "${paramPath}"` }
		return true
	}

	private async exists(fullPath: string) {
		try {
			await fsAccess(fullPath, fs.constants.R_OK)
			return true
		} catch (_err) {
			return false
		}
	}
	private async cleanupOldFiles() {
		// Check the config. 0 or -1 means it's disabled:
		if (this.config.httpServer.cleanFileAge <= 0) {
			this.logger.info('Cleaning up old files is DISABLED')
			return
		}

		this.logger.info(`Cleaning up files older than ${this.config.httpServer.cleanFileAge}s...`)

		let fileCount = 0
		let dirCount = 0
		let removeFileCount = 0
		let removeDirCount = 0

		const cleanUpDirectory = async (dirPath: string, removeEmptyDir: boolean) => {
			const now = Date.now()
			const files = await fsReaddir(path.join(this._basePath, dirPath))

			if (files.length === 0) {
				if (removeEmptyDir) {
					this.logger.debug(`Removing empty directory "${dirPath}"`)
					await fsRmDir(path.join(this._basePath, dirPath))
					removeDirCount++
				}
			} else {
				for (const fileName of files) {
					const filePath = path.join(dirPath, fileName)
					const fullPath = path.join(this._basePath, filePath)
					const lStat = await fsLstat(fullPath)
					if (lStat.isDirectory()) {
						dirCount++
						await cleanUpDirectory(filePath, true)
					} else {
						fileCount++

						const age = Math.floor((now - lStat.mtimeMs) / 1000) // in seconds

						if (age > this.config.httpServer.cleanFileAge) {
							this.logger.debug(`Removing file "${filePath}" (age: ${age}s)`)
							await fsUnlink(fullPath)
							removeFileCount++
						}
					}
				}
			}
		}

		try {
			await cleanUpDirectory('', false)
		} catch (error) {
			this.logger.error(`Error when cleaning up: ${error}`)
		}

		this.logger.info(
			`Done, removed ${removeFileCount} files and ${removeDirCount} directories (out of ${fileCount} files and ${dirCount} directories)`
		)

		// Schedule to run at 3:15 tomorrow:
		const d = new Date()
		const nextTime = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 3, 15, 0) // Tomorrow, at 3:15
		const timeUntilNext = nextTime.getTime() - Date.now()

		if (timeUntilNext <= 0) throw new Error(`timeUntilNext is negative! (${timeUntilNext})`)

		this.logger.debug(`Next cleaning at ${nextTime.toISOString()} (in ${timeUntilNext}ms)`)
		setTimeout(() => {
			this.cleanupOldFiles().catch(this.logger.error)
		}, timeUntilNext)
	}
	/**
	 * Set the headers for content requests (GET, HEAD), using provided FileInfo object
	 *
	 * @private
	 * @param {FileInfo} info
	 * @param {CTX} ctx
	 * @memberof FileStorage
	 */
	private setHeaders(info: FileInfo, ctx: CTX) {
		ctx.type = info.mimeType
		ctx.length = info.length
		ctx.lastModified = info.lastModified

		// Check the config. 0 or -1 means it's disabled:
		if (this.config.httpServer.cleanFileAge >= 0) {
			ctx.set(
				'Expires',
				FileStorage.calculateExpiresTimestamp(info.lastModified, this.config.httpServer.cleanFileAge)
			)
		}
	}
	/**
	 * Calculate the expiration timestamp, given a starting Date point and timespan duration
	 *
	 * @private
	 * @static
	 * @param {Date} begin
	 * @param {number} durationS in seconds
	 * @return {*}
	 * @memberof FileStorage
	 */
	private static calculateExpiresTimestamp(begin: Date, durationS: number) {
		return new Date(begin.getTime() + durationS * 1000).toUTCString()
	}
}
