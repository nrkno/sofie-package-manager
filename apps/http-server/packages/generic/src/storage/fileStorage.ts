import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import mime from 'mime-types'
import mkdirp from 'mkdirp'
import prettyBytes from 'pretty-bytes'
import { CTX, CTXPost } from '../lib'
import { HTTPServerConfig } from '@sofie-package-manager/api'
import { BadResponse, Storage } from './storage'

// Note: Explicit types here, due to that for some strange reason, promisify wont pass through the correct typings.
const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)
const fsReaddir = promisify(fs.readdir)
const fsLstat = promisify(fs.lstat)
const fsWriteFile = promisify(fs.writeFile)

export class FileStorage extends Storage {
	private _basePath: string
	constructor(config: HTTPServerConfig) {
		super()
		this._basePath = path.resolve(config.httpServer.basePath)
	}

	getInfo(): string {
		return this._basePath
	}

	async init(): Promise<void> {
		await mkdirp(this._basePath)
	}

	async listPackages(ctx: CTX): Promise<true | BadResponse> {
		type PackageInfo = {
			path: string
			size: string
			modified: string
		}
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

		ctx.body = { packages: packages }

		return true
	}
	private async getFileInfo(paramPath: string): Promise<
		| {
				found: false
		  }
		| {
				found: true
				fullPath: string
				mimeType: string
				length: number
				lastModified: Date
		  }
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

		ctx.type = fileInfo.mimeType
		ctx.length = fileInfo.length
		ctx.lastModified = fileInfo.lastModified

		ctx.response.status = 204

		ctx.body = undefined

		return true
	}
	async getPackage(paramPath: string, ctx: CTX): Promise<true | BadResponse> {
		const fileInfo = await this.getFileInfo(paramPath)
		if (!fileInfo.found) {
			return { code: 404, reason: 'Package not found' }
		}

		ctx.type = fileInfo.mimeType // or use mime.contentType(fullPath) ?
		ctx.length = fileInfo.length
		ctx.lastModified = fileInfo.lastModified
		const readStream = fs.createReadStream(fileInfo.fullPath)
		ctx.body = readStream

		return true
	}
	async postPackage(paramPath: string, ctx: CTXPost): Promise<true | BadResponse> {
		const fullPath = path.join(this._basePath, paramPath)

		await mkdirp(path.dirname(fullPath))

		const exists = await this.exists(fullPath)
		if (exists) await fsUnlink(fullPath)

		if (ctx.request.body?.text) {
			// store plain text into file
			await fsWriteFile(fullPath, ctx.request.body.text)

			ctx.body = { code: 201, message: `${exists ? 'Updated' : 'Inserted'} "${paramPath}"` }
			ctx.response.status = 201
			return true
		} else if (ctx.request.files?.length) {
			const file = (ctx.request.files as any)[0]
			const stream = file.stream as fs.ReadStream

			stream.pipe(fs.createWriteStream(fullPath))

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
}
