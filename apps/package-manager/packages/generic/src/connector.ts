import {
	ClientConnectionOptions,
	LoggerInstance,
	PackageManagerConfig,
	ProcessHandler,
	stringifyError,
} from '@shared/api'
import { ExpectationManager, ExpectationManagerServerOptions } from '@shared/expectation-manager'
import { CoreHandler, CoreConfig } from './coreHandler'
import { PackageManagerHandler } from './packageManager'
import chokidar from 'chokidar'
import fs from 'fs'
import { promisify } from 'util'
import path from 'path'

const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)

export interface Config {
	process: ProcessConfig
	device: DeviceConfig
	core: CoreConfig
	packageManager: PackageManagerConfig
}
export interface ProcessConfig {
	/** Will cause the Node applocation to blindly accept all certificates. Not recommenced unless in local, controlled networks. */
	unsafeSSL: boolean
	/** Paths to certificates to load, for SSL-connections */
	certificates: string[]
}
export interface DeviceConfig {
	deviceId: string
	deviceToken: string
}
export class Connector {
	private packageManagerHandler: PackageManagerHandler
	private coreHandler: CoreHandler

	constructor(
		private _logger: LoggerInstance,
		private config: PackageManagerConfig,
		private _process: ProcessHandler
	) {
		this.coreHandler = new CoreHandler(this._logger, this.config.packageManager)

		const packageManagerServerOptions: ExpectationManagerServerOptions =
			config.packageManager.port !== null
				? {
						type: 'websocket',
						port: config.packageManager.port,
				  }
				: { type: 'internal' }

		const workForceConnectionOptions: ClientConnectionOptions = config.packageManager.workforceURL
			? {
					type: 'websocket',
					url: config.packageManager.workforceURL,
			  }
			: { type: 'internal' }

		this.packageManagerHandler = new PackageManagerHandler(
			this._logger,
			config.packageManager.deviceId || 'manager0',
			packageManagerServerOptions,
			config.packageManager.accessUrl || undefined,
			workForceConnectionOptions
		)
	}

	public async init(): Promise<void> {
		try {
			if (!this.config.packageManager.noCore) {
				this._logger.info('Initializing Core...')
				await this.coreHandler.init(this.config, this._process)
				this._logger.info('Core initialized')
			} else {
				this._logger.info('Skipping connecting to Core...')
				this.coreHandler.setNoCore()
			}

			this._logger.info('Initializing PackageManager...')
			await this.packageManagerHandler.init(this.config, this.coreHandler)
			this._logger.info('PackageManager initialized')

			if (this.config.packageManager.watchFiles) {
				this._logger.info('Initializing file watcher...')
				await this.initFileWatcher(this.packageManagerHandler)
				this._logger.info('file watcher initialized')
			}

			this._logger.info('Initialization done')
			return
		} catch (e) {
			this._logger.error(`Error during initialization: ${stringifyError(e)}`)

			if (this.coreHandler) {
				this.coreHandler.destroy().catch(this._logger.error)
			}

			this._logger.info('Shutting down in 10 seconds!')
			setTimeout(() => {
				// eslint-disable-next-line no-process-exit
				process.exit(0)
			}, 10 * 1000)
			return
		}
	}

	private async initFileWatcher(packageManagerHandler: PackageManagerHandler): Promise<void> {
		const fileName = path.join(process.cwd(), './expectedPackages.json')
		const watcher = chokidar.watch(fileName, { persistent: true })

		this._logger.info(`Watching file "${fileName}"`)

		watcher
			.on('add', () => {
				triggerReloadInput()
			})
			.on('change', () => {
				triggerReloadInput()
			})
			.on('unlink', () => {
				triggerReloadInput()
			})
			.on('error', (error) => {
				this._logger.error(`Error emitter in Filewatcher: ${stringifyError(error)}`)
			})
		const triggerReloadInput = () => {
			setTimeout(() => {
				reloadInput().catch((error) => {
					this._logger.error(`Error in reloadInput: ${stringifyError(error)}`)
				})
			}, 100)
		}
		const reloadInput = async () => {
			this._logger.info(`Change detected in ${fileName}`)
			// Check that the file exists:
			try {
				await fsAccess(fileName)
			} catch (_err) {
				// ignore
				return
			}

			const str = await fsReadFile(fileName, { encoding: 'utf-8' })
			const o = JSON.parse(str)

			if (o.packageContainers && o.expectedPackages) {
				packageManagerHandler.setExternalData(o.packageContainers, o.expectedPackages)
			}
		}
	}
	getExpectationManager(): ExpectationManager {
		return this.packageManagerHandler.getExpectationManager()
	}
}
