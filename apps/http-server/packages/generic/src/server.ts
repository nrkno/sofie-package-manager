import { promisify } from 'util'

import fs from 'fs'
import Koa from 'koa'
import Router from 'koa-router'
import cors from '@koa/cors'
import multer from '@koa/multer'
import bodyParser from 'koa-bodyparser'

import { HTTPServerConfig, LoggerInstance, stringifyError } from '@shared/api'
import { BadResponse, Storage } from './storage/storage'
import { FileStorage } from './storage/fileStorage'
import { CTX } from './lib'

const fsReadFile = promisify(fs.readFile)

export class PackageProxyServer {
	private app = new Koa()
	private router = new Router()
	private upload = multer({ limits: { fileSize: 300 * 1024 * 1024 } })

	private storage: Storage

	constructor(private logger: LoggerInstance, private config: HTTPServerConfig) {
		this.app.on('error', (err) => {
			const errString = stringifyError(err)

			// We get a lot of these errors, ignore them:
			if (errString.match(/ECONNRESET|ECONNABORTED|ECANCELED/)) {
				// ignore these
			} else {
				this.logger.warn(`PackageProxyServer Error: ${errString}`)
			}
		})

		this.app.use(this.upload.any())
		this.app.use(bodyParser())

		this.app.use(
			cors({
				origin: '*',
			})
		)

		// todo: Add other storages?
		this.storage = new FileStorage(this.config)
	}

	async init(): Promise<void> {
		this.logger.info('Initializing server')

		await this.storage.init()

		await this._setUpRoutes()
	}
	private _setUpRoutes(): Promise<void> {
		this.router.all('*', async (ctx, next) => {
			// Intercept and authenticate:

			const apiKey: string =
				ctx.request.query?.apiKey || // Querystring parameter
				ctx.request.body?.apiKey // Body parameter

			if (ctx.request.method === 'GET') {
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

			ctx.response.status = 403
			ctx.body = 'Api key "?apiKey=API_KEY" missing or is invalid.'
		})

		this.router.get('/packages', async (ctx) => {
			await this.handleStorage(ctx, () => this.storage.listPackages(ctx))
		})
		this.router.get('/package/:path+', async (ctx) => {
			await this.handleStorage(ctx, () => this.storage.getPackage(ctx.params.path, ctx))
		})
		this.router.post('/package/:path+', async (ctx) => {
			await this.handleStorage(ctx, () => this.storage.postPackage(ctx.params.path, ctx))
		})
		this.router.delete('/package/:path+', async (ctx) => {
			await this.handleStorage(ctx, () => this.storage.deletePackage(ctx.params.path, ctx))
		})

		// Convenient pages:
		this.router.get('/', async (ctx, next) => {
			let packageJson = { version: '0.0.0' }
			try {
				packageJson = JSON.parse(
					await fsReadFile('../package.json', {
						encoding: 'utf8',
					})
				)
			} catch (err) {
				// ignore
			}
			ctx.body = { name: 'Package proxy server', version: packageJson.version }
			await next()
		})
		this.router.get('/uploadForm/:path+', async (ctx) => {
			// ctx.response.status = result.code
			ctx.type = 'text/html'
			ctx.body = (await fsReadFile('./static/uploadForm.html', 'utf-8'))
				.replace('$path', `/package/${ctx.params.path}`)
				.replace('$apiKey', ctx.request.query.apiKey)
		})

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

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
	private async handleStorage(ctx: CTX, storageFcn: () => Promise<true | BadResponse>) {
		try {
			const result = await storageFcn()
			if (result !== true) {
				ctx.response.status = result.code
				ctx.body = result.reason
			}
		} catch (err) {
			this.logger.error(`Error in handleStorage: ${stringifyError(err)} `)
			ctx.response.status = 500
			ctx.body = 'Internal server error'
		}
	}
}
