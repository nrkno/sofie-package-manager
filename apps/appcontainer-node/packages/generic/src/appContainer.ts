import * as ChildProcess from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { LoggerInstance, AppContainerProcessConfig, ClientConnectionOptions, LogLevel } from '@shared/api'
import { WorkforceAPI } from './workforceApi'

/** Mimimum time between app restarts */
const RESTART_COOLDOWN = 60 * 1000 // ms

export class AppContainer {
	private workforceAPI: WorkforceAPI
	private id: string
	private connectionOptions: ClientConnectionOptions
	private appId = 0

	private apps: {
		[appId: string]: {
			process: ChildProcess.ChildProcess
			appType: string
			toBeKilled: boolean
			restarts: number
			lastRestart: number
		}
	} = {}
	private availableApps: {
		[appType: string]: AvailableAppInfo
	} = {}

	constructor(private logger: LoggerInstance, private config: AppContainerProcessConfig) {
		this.workforceAPI = new WorkforceAPI(this.logger)

		this.id = config.appContainer.appContainerId
		this.connectionOptions = this.config.appContainer.workforceURL
			? {
					type: 'websocket',
					url: this.config.appContainer.workforceURL,
			  }
			: {
					type: 'internal',
			  }
	}
	async init(): Promise<void> {
		if (this.connectionOptions.type === 'websocket') {
			this.logger.info(`AppContainer: Connecting to Workforce at "${this.connectionOptions.url}"`)
		}

		await this.setupAvailableApps()

		await this.workforceAPI.init(this.id, this.connectionOptions, this)

		await this.workforceAPI.registerAvailableApps(
			Object.entries(this.availableApps).map((o) => {
				const appType = o[0] as string
				return {
					appType: appType,
				}
			})
		)

		// Todo later:
		// Sent the workforce a list of:
		// * the types of workers we can spin up
		// * what the running cost is for them
		// * how many can be spun up
		// * etc...
	}
	private async setupAvailableApps() {
		const getWorkerArgs = (appId: string): string[] => {
			return [
				`--workerId=${appId}`,
				`--workforceURL=${this.config.appContainer.workforceURL}`,
				this.config.appContainer.windowsDriveLetters
					? `--windowsDriveLetters=${this.config.appContainer.windowsDriveLetters?.join(';')}`
					: '',
				this.config.appContainer.resourceId ? `--resourceId=${this.config.appContainer.resourceId}` : '',
				this.config.appContainer.networkIds.length
					? `--networkIds=${this.config.appContainer.networkIds.join(';')}`
					: '',
			]
		}
		if (process.execPath.match(/node.exe$/)) {
			// Process runs as a node process, we're probably in development mode.
			this.availableApps['worker'] = {
				file: process.execPath,
				args: (appId: string) => {
					return [path.resolve('.', '../../worker/app/dist/index.js'), ...getWorkerArgs(appId)]
				},
			}
		} else {
			// Process is a compiled executable
			// Look for the worker executable in the same folder:

			const dirPath = path.dirname(process.execPath)
			// Note: nexe causes issues with its virtual file system: https://github.com/nexe/nexe/issues/613#issuecomment-579107593

			;(await fs.promises.readdir(dirPath)).forEach((fileName) => {
				if (fileName.match(/worker/i)) {
					this.availableApps[fileName] = {
						file: path.join(dirPath, fileName),
						args: (appId: string) => {
							return [...getWorkerArgs(appId)]
						},
					}
				}
			})
		}
	}
	terminate(): void {
		this.workforceAPI.terminate()

		// kill child processes
	}
	async setLogLevel(logLevel: LogLevel): Promise<void> {
		this.logger.level = logLevel
	}
	async _debugKill(): Promise<void> {
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}

	async spinUp(appType: AppType): Promise<string> {
		const availableApp = this.availableApps[appType]
		if (!availableApp) throw new Error(`Unknown appType "${appType}"`)

		const appId = `${this.id}_${this.appId++}`

		const child = this.setupChildProcess(appType, appId, availableApp)
		this.apps[appId] = {
			process: child,
			appType: appType,
			toBeKilled: false,
			restarts: 0,
			lastRestart: 0,
		}
		return appId
	}
	async spinDown(appId: string): Promise<void> {
		const app = this.apps[appId]
		if (!app) throw new Error(`App "${appId}" not found`)

		app.toBeKilled = true
		const success = app.process.kill()
		if (!success) throw new Error(`Internal error: Killing of process "${app.process.pid}" failed`)

		app.process.removeAllListeners()
		delete this.apps[appId]
	}
	async getRunningApps(): Promise<{ appId: string; appType: string }[]> {
		return Object.entries(this.apps).map((o) => {
			const [appId, app] = o

			return {
				appId: appId,
				appType: app.appType,
			}
		})
	}
	private setupChildProcess(
		appType: AppType,
		appId: string,
		availableApp: AvailableAppInfo
	): ChildProcess.ChildProcess {
		this.logger.info(`Starting process "${appId}" (${appType}): "${availableApp.file}"`)
		const cwd = process.execPath.match(/node.exe$/)
			? undefined // Process runs as a node process, we're probably in development mode.
			: path.dirname(process.execPath) // Process runs as a node process, we're probably in development mode.

		const child = ChildProcess.execFile(availableApp.file, availableApp.args(appId), {
			cwd: cwd,
		})

		child.stdout?.on('data', (data) => {
			this.logger.debug(`${appId} stdout: ${data}`)
		})
		child.stderr?.on('data', (data) => {
			this.logger.debug(`${appId} stderr: ${data}`)
		})
		child.once('close', (code) => {
			const app = this.apps[appId]
			if (app && !app.toBeKilled) {
				// Try to restart the application

				const timeUntilRestart = Math.max(0, app.lastRestart - Date.now() + RESTART_COOLDOWN)
				this.logger.warn(
					`App ${app.process.pid} (${appType}) closed with code (${code}), trying to restart in ${timeUntilRestart} ms (restarts: ${app.restarts})`
				)

				setTimeout(() => {
					app.lastRestart = Date.now()
					app.restarts++

					app.process.removeAllListeners()

					const newChild = this.setupChildProcess(appType, appId, availableApp)

					app.process = newChild
				}, timeUntilRestart)
			}
		})

		return child
	}
}
type AppType = 'worker' // | other
interface AvailableAppInfo {
	file: string
	args: (appId: string) => string[]
}
