import { promisify } from 'util'

import fs from 'fs'
import Koa from 'koa'
import Router from 'koa-router'
import cors from '@koa/cors'
import multer from '@koa/multer'
import bodyParser from 'koa-bodyparser'
import { Server as HttpServer } from 'http'

import { HTTPServerConfig, LoggerInstance, stringifyError, first } from '@sofie-package-manager/api'
import { BadResponse, Storage } from './storage/storage'
import { FileStorage } from './storage/fileStorage'
import { CTX } from './lib'

const fsReadFile = promisify(fs.readFile)

export class PackageProxyServer {
	private app = new Koa()
	private router = new Router()
	private upload = multer({ limits: { fileSize: 300 * 1024 * 1024 } })
	private server?: HttpServer

	private storage: Storage
	private logger: LoggerInstance

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

		this.app.use(this.upload.any())
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
	async getDebugDump(): Promise<{ listening: boolean; connections: number }> {
		const connections = await new Promise<number>((r) => this.server?.getConnections((_, count) => r(count)))

		return {
			listening: this.server?.listening || false,
			connections,
		}
	}
	private async _setUpRoutes(): Promise<void> {
		this.router.all('*', async (ctx, next) => {
			// Intercept and authenticate:

			const apiKey: string =
				ctx.request.query?.apiKey || // Querystring parameter
				ctx.request.body?.apiKey // Body parameter

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
			await this.handleStorage(ctx, async () => this.storage.listPackages(ctx))
		})
		this.router.get('/package/:path+', async (ctx) => {
			await this.handleStorage(ctx, async () => this.storage.getPackage(ctx.params.path, ctx))
		})
		this.router.head('/package/:path+', async (ctx) => {
			await this.handleStorage(ctx, async () => this.storage.headPackage(ctx.params.path, ctx))
		})
		this.router.post('/package/:path+', async (ctx) => {
			this.logger.debug(`POST ${ctx.request.URL}`)
			await this.handleStorage(ctx, async () => this.storage.postPackage(ctx.params.path, ctx))
		})
		this.router.delete('/package/:path+', async (ctx) => {
			this.logger.debug(`DELETE ${ctx.request.URL}`)
			await this.handleStorage(ctx, async () => this.storage.deletePackage(ctx.params.path, ctx))
		})

		// Convenient pages:
		this.router.get('/', async (ctx) => {
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
			ctx.body = { name: 'Package proxy server', version: packageJson.version, info: this.storage.getInfo() }
		})
		this.router.get('/uploadForm/:path+', async (ctx) => {
			// ctx.response.status = result.code
			ctx.type = 'text/html'
			ctx.body = (await fsReadFile('./static/uploadForm.html', 'utf-8'))
				.replace('$path', `/package/${ctx.params.path}`)
				.replace('$apiKey', first(ctx.request.query.apiKey) ?? '')
		})
		this.router.get('/health', async (ctx) => {
			let packageJson = {} as { version?: string }
			try {
				packageJson = JSON.parse(
					await fsReadFile('../package.json', {
						encoding: 'utf8',
					})
				)
			} catch (err) {
				// ignore
			}

			// presume it's always OK if we can reply to http requests
			ctx.type = 'application/json'
			ctx.body = {
				status: 'ok',
				name: 'Package proxy server',
				updated: new Date(),
				documentation: 'https://nrkconfluence.atlassian.net/wiki/spaces/Sof',
				statusMessage: 'this healthy boy says hello to you',
				appVersion: packageJson.version,
			}
		})

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

		this.app.use((ctx) => {
			ctx.body = 'Page not found'
			ctx.response.status = 404
		})

		return new Promise<void>((resolve, reject) => {
			if (this.config.httpServer.port) {
				this.server = this.app.listen(this.config.httpServer.port, () => {
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
