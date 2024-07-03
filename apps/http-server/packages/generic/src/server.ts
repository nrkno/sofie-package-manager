import { promisify } from 'util'

import fs from 'fs'
import Koa from 'koa'
import path from 'path'
import Router from 'koa-router'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'

import { HTTPServerConfig, LoggerInstance, stringifyError, first } from '@sofie-package-manager/api'
import { BadResponse, PackageInfo, Sidecar, Storage, isBadResponse } from './storage/storage'
import { FileStorage } from './storage/fileStorage'
import { CTX, PACKAGE_JSON_VERSION, valueOrFirst } from './lib'
import { parseFormData } from 'pechkin'

const fsReadFile = promisify(fs.readFile)

const MAX_UPLOAD_FILE_SIZE = 300 * 1024 * 1024

export class PackageProxyServer {
	private app = new Koa()
	private router = new Router()

	private storage: Storage
	private logger: LoggerInstance

	private startupTime = Date.now()

	constructor(logger: LoggerInstance, private config: HTTPServerConfig) {
		this.logger = logger.category('PackageProxyServer')
		this.app.on('error', (err) => {
			const errString = stringifyError(err)

			// We get a lot of these errors, ignore them:
			if (errString.match(/ECONNRESET|ECONNABORTED|ECANCELED/)) {
				// ignore these
			} else {
				this.logger.error(`PackageProxyServer Error: ${errString}`)
			}
		})

		this.app.use(bodyParser())

		this.app.use(
			cors({
				origin: '*',
			})
		)

		// todo: Add other storages?
		this.storage = new FileStorage(this.logger, this.config)
	}

	async init(): Promise<void> {
		this.logger.info('Initializing server')

		await this.storage.init()

		await this._setUpRoutes()
	}
	private async _setUpRoutes(): Promise<void> {
		this.router.all('(.*)', async (ctx, next) => {
			// Intercept and authenticate:

			const apiKey: string | undefined =
				valueOrFirst(ctx.request.query?.apiKey) || // Querystring parameter
				(ctx.request.body as { apiKey?: string })?.apiKey // Body parameter

			if (ctx.request.method === 'GET' || ctx.request.method === 'HEAD') {
				if (
					// Both read and write keys are accepted for GET requests
					!this.config.httpServer.apiKeyRead ||
					apiKey === this.config.httpServer.apiKeyRead ||
					apiKey === this.config.httpServer.apiKeyWrite
				) {
					return next() // OK
				}
			} else {
				if (!this.config.httpServer.apiKeyWrite || apiKey === this.config.httpServer.apiKeyWrite) {
					return next() // OK
				}
			}

			this.logger.warn(`[403] ${ctx.request.URL}`)

			ctx.response.status = 403
			ctx.body = 'Api key "?apiKey=API_KEY" missing or is invalid.'
		})

		this.router.get('/packages', async (ctx) => {
			await this.handleStorage(ctx, async () => this.storage.listPackages())
		})
		this.router.get('/list', async (ctx) => {
			await this.handleStorageHTMLList(ctx, async () => this.storage.listPackages())
		})
		this.router.get('/package/:path+', async (ctx) => {
			await this.handleStorage(ctx, async () => this.storage.getPackage(ctx.params.path))
		})
		this.router.head('/package/:path+', async (ctx) => {
			await this.handleStorage(ctx, async () => this.storage.headPackage(ctx.params.path))
		})
		this.router.post('/package/:path+', async (ctx) => {
			this.logger.debug(`POST ${ctx.request.URL}`)
			const { files, fields } = await parseFormData(ctx.req, {
				maxFileByteLength: MAX_UPLOAD_FILE_SIZE,
				abortOnFileByteLengthLimit: true,
				maxTotalFileCount: 1,
			})
			if (fields.text) {
				// A string in the "text"-field, store that as a file:
				await this.handleStorage(ctx, async () => this.storage.postPackage(ctx.params.path, ctx, fields.text))
			} else {
				// Handle uploaded files:
				let fileCount = 0
				for await (const file of files) {
					fileCount++
					if (fileCount !== 1) throw new Error('HTTP-server: POST only support uploading of one (1) file!')
					await this.handleStorage(ctx, async () =>
						this.storage.postPackage(ctx.params.path, ctx, file?.stream)
					)
				}
			}
		})
		this.router.delete('/package/:path+', async (ctx) => {
			this.logger.debug(`DELETE ${ctx.request.URL}`)
			await this.handleStorage(ctx, async () => this.storage.deletePackage(ctx.params.path))
		})

		// Convenient pages:
		this.router.get('/', async (ctx) => {
			ctx.body = {
				name: 'Package proxy server',
				version: PACKAGE_JSON_VERSION,
				uptime: Date.now() - this.startupTime,
				info: this.storage.getInfo(),
			}
		})
		this.router.get('/uploadForm/:path+', async (ctx) => {
			// ctx.response.status = result.code
			ctx.type = 'text/html'
			ctx.body = (await fsReadFile(path.join(__dirname, '../static/uploadForm.html'), 'utf-8'))
				.replace('$path', `/package/${ctx.params.path}`)
				.replace('$apiKey', first(ctx.request.query.apiKey) ?? '')
		})

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

		this.app.use((ctx) => {
			ctx.body = 'Page not found'
			ctx.response.status = 404
		})

		this.app.on('error', (err) => {
			this.logger.error(`Server error: ${err}`)
		})

		return new Promise<void>((resolve, reject) => {
			if (this.config.httpServer.port) {
				this.app.listen(this.config.httpServer.port, () => {
					this.logger.info(`HTTP server listening on port ${this.config.httpServer.port}`)
					resolve()
				})
			} else {
				reject('No port provided')
			}
		})
	}
	private async handleStorage(ctx: CTX, storageFcn: () => Promise<{ sidecar: Sidecar; body?: any } | BadResponse>) {
		try {
			const result = await storageFcn()
			if (isBadResponse(result)) {
				ctx.response.status = result.code
				ctx.body = result.reason
			} else {
				ctx.response.status = result.sidecar.statusCode
				if (result.sidecar.type !== undefined) ctx.type = result.sidecar.type
				if (result.sidecar.length !== undefined) ctx.length = result.sidecar.length
				if (result.sidecar.lastModified !== undefined) ctx.lastModified = result.sidecar.lastModified

				for (const [key, value] of Object.entries<string>(result.sidecar.headers)) {
					ctx.set(key, value)
				}

				if (result.body) ctx.body = result.body
			}
		} catch (err) {
			this.logger.error(`Error in handleStorage: ${stringifyError(err)} `)
			ctx.response.status = 500
			ctx.body = 'Internal server error'
		}
	}
	private async handleStorageHTMLList(
		ctx: CTX,
		storageFcn: () => Promise<{ body: { packages: PackageInfo[] } } | BadResponse>
	) {
		try {
			const result = await storageFcn()
			if (isBadResponse(result)) {
				ctx.response.status = result.code
				ctx.body = result.reason
			} else {
				const packages = result.body.packages

				ctx.set('Content-Type', 'text/html')
				ctx.body = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: Arial, sans-serif; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px; }

</style>
</head>
<body>
<h1>Packages</h1>
<table>
${packages
	.map(
		(pkg) =>
			`<tr>
		<td><a href="/package/${pkg.path}">${pkg.path}</a></td>
		<td>${pkg.size}</td>
		<td>${pkg.modified}</td>
	</tr>`
	)
	.join('')}
</table>
</body>
</html>`
			}
		} catch (err) {
			this.logger.error(`Error in handleStorage: ${stringifyError(err)} `)
			ctx.response.status = 500
			ctx.body = 'Internal server error'
		}
	}
}
