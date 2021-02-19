import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import * as mime from 'mime-types'
import * as mkdirp from 'mkdirp'
import * as prettyBytes from 'pretty-bytes'
import { CTX, CTXPost } from '../lib'
import { HTTPServerConfig } from '@shared/api'
import { BadResponse, Storage } from './storage'

// Note: Explicit types here, due to that for some strange reason, promisify wont pass through the correct typings.
const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)
const fsReaddir = promisify(fs.readdir)
const fsLstat = promisify(fs.lstat)
const fsWriteFile = promisify(fs.writeFile)

export class FileStorage extends Storage {
	constructor(private config: HTTPServerConfig) {
		super()
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

		await getAllFiles(this.config.httpServer.basePath, '')

		packages.sort((a, b) => {
			if (a.path > b.path) return 1
			if (a.path < b.path) return -1
			return 0
		})

		ctx.body = { packages: packages }

		return true
	}
	async getPackage(paramPath: string, ctx: CTX): Promise<true | BadResponse> {
		const fullPath = path.join(this.config.httpServer.basePath, paramPath)

		if (!(await this.exists(fullPath))) {
			return { code: 404, reason: 'Not found' }
		}
		let mimeType = mime.lookup(fullPath)
		if (!mimeType) {
			// Fallback to "unknown binary":
			mimeType = 'application/octet-stream'
			// return { code: 501, reason: 'Unknown / unsupported file format' }
		}

		const stat = await fsStat(fullPath)

		ctx.type = mimeType // or use mime.contentType(fullPath) ?
		const readStream = fs.createReadStream(fullPath)
		ctx.body = readStream

		ctx.length = stat.size

		return true
	}
	async postPackage(paramPath: string, ctx: CTXPost): Promise<true | BadResponse> {
		const fullPath = path.join(this.config.httpServer.basePath, paramPath)

		await mkdirp(path.dirname(fullPath))

		const exists = await this.exists(fullPath)
		if (exists) await fsUnlink(fullPath)

		if (ctx.request.body?.text) {
			// store plain text into file
			await fsWriteFile(fullPath, ctx.request.body.text)

			ctx.body = { message: `${exists ? 'Updated' : 'Inserted'} "${paramPath}"` }
			return true
		} else if (ctx.request.files?.length) {
			const file = ctx.request.files[0] as any
			const stream = file.stream as fs.ReadStream

			stream.pipe(fs.createWriteStream(fullPath))

			ctx.body = { message: `${exists ? 'Updated' : 'Inserted'} "${paramPath}"` }
			return true
		} else {
			return { code: 400, reason: 'No files provided' }
		}
	}
	async deletePackage(paramPath: string, ctx: CTXPost): Promise<true | BadResponse> {
		const fullPath = path.join(this.config.httpServer.basePath, paramPath)

		if (!(await this.exists(fullPath))) {
			return { code: 404, reason: 'Not found' }
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
