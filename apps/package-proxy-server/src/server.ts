import { promisify } from 'util'
import { LoggerInstance } from 'winston'

import * as fs from 'fs'
import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as cors from '@koa/cors'
import * as multer from '@koa/multer'
import * as bodyParser from 'koa-bodyparser'

import { Config } from './config'
import { Storage } from './storage/storage'
import { FileStorage } from './storage/fileStorage'

const fsReadFile = promisify(fs.readFile)

export class PackageProxyServer {
	private app = new Koa()
	private router = new Router()
	private upload = multer({ limits: { fileSize: 300 * 1024 * 1024 } })

	private storage: Storage

	constructor(private logger: LoggerInstance, private config: Config) {
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

	async init() {
		this.logger.info('Initializing server')

		this._setUpRoutes()
	}
	private _setUpRoutes() {
		this.router.all('*', async (ctx, next) => {
			// Intercept and authenticate:

			const apiKey: string =
				ctx.request.query?.apiKey || // Querystring parameter
				ctx.request.body?.apiKey // Body parameter

			if (ctx.request.method === 'GET') {
				if (
					// Both read and write keys are accepted for GET requests
					!this.config.proxyServer.apiKeyRead ||
					apiKey === this.config.proxyServer.apiKeyRead ||
					apiKey === this.config.proxyServer.apiKeyWrite
				) {
					return next() // OK
				}
			} else {
				if (!this.config.proxyServer.apiKeyWrite || apiKey === this.config.proxyServer.apiKeyWrite) {
					return next() // OK
				}
			}

			ctx.response.status = 403
			ctx.body = 'Api key "?apiKey=API_KEY" missing or is invalid.'
		})

		this.router.get('/package/:path+', async (ctx) => {
			try {
				const result = await this.storage.getPackage(ctx.params.path, ctx)
				if (result === true) {
					// await next()
				} else {
					ctx.response.status = result.code
					ctx.body = result.reason
				}
			} catch (err) {
				this.logger.error(err)
				this.logger.error(err.stack)
				ctx.response.status = 500
				ctx.body = 'Internal server error'
			}
		})
		this.router.get('/packages', async (ctx) => {
			try {
				const result = await this.storage.listPackages(ctx)
				if (result === true) {
					// await next()
				} else {
					ctx.response.status = result.code
					ctx.body = result.reason
				}
			} catch (err) {
				this.logger.error(err)
				this.logger.error(err.stack)
				ctx.response.status = 500
				ctx.body = 'Internal server error'
			}
		})
		this.router.post('/package/:path+', async (ctx) => {
			try {
				const result = await this.storage.postPackage(ctx.params.path, ctx)
				if (result === true) {
					// await next()
				} else {
					ctx.response.status = result.code
					ctx.body = result.reason
				}
			} catch (err) {
				this.logger.error(err)
				this.logger.error(err.stack)
				ctx.response.status = 500
				ctx.body = 'Internal server error'
			}
		})
		this.router.delete('/package/:path+', async (ctx) => {
			try {
				const result = await this.storage.deletePackage(ctx.params.path, ctx)
				if (result === true) {
					// await next()
				} else {
					ctx.response.status = result.code
					ctx.body = result.reason
				}
			} catch (err) {
				this.logger.error(err)
				this.logger.error(err.stack)
				ctx.response.status = 500
				ctx.body = 'Internal server error'
			}
		})

		// Convenient pages:
		this.router.get('/', async (ctx, next) => {
			ctx.body = { name: 'Package proxy server', version: require('../package.json').version }
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
			if (this.config.proxyServer.port) {
				this.app.listen(this.config.proxyServer.port, () => {
					this.logger.info(`HTTP server listening on port ${this.config.proxyServer.port}`)
					resolve()
				})
			} else {
				reject('No port provided')
			}
		})
	}
}
