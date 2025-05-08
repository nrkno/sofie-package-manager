import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import _ from 'underscore'
import {
	LoggerInstance,
	AppContainerProcessConfig,
	ClientConnectionOptions,
	LogLevel,
	WebsocketServer,
	ClientConnection,
	AppContainerWorkerAgent,
	assertNever,
	Expectation,
	waitTime,
	APPCONTAINER_PING_TIME,
	PackageContainerExpectation,
	Reason,
	stringifyError,
	setLogLevel,
	isNodeRunningInDebugMode,
	INNER_ACTION_TIMEOUT,
	DataStore,
	literal,
	WorkForceAppContainer,
	mapEntries,
	findValue,
	AppContainerId,
	AppType,
	AppId,
	WorkerAgentId,
	unprotectString,
	DataId,
	LockId,
	protectString,
	getLogLevel,
	Cost,
	LeveledLogMethodLight,
} from '@sofie-package-manager/api'

import { WorkforceAPI } from './workforceApi'
import { WorkerAgentAPI } from './workerAgentApi'
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'

/** Mimimum time between app restarts */
const RESTART_COOLDOWN = 60 * 1000 // ms

const WORKER_DATA_LOCK_TIMEOUT = INNER_ACTION_TIMEOUT

const MAX_APP_ID = 10000000

export class AppContainer {
	private workforceAPI: WorkforceAPI
	private id: AppContainerId
	private workForceConnectionOptions: ClientConnectionOptions
	private appId = 0
	private usedInspectPorts = new Set<number>()
	private busyPorts = new Set<number>()

	private apps: Map<AppId, RunningAppInfo> = new Map()
	private availableApps: Map<AppType, AvailableAppInfo> = new Map()
	private websocketServer?: WebsocketServer

	private monitorAppsTimer: NodeJS.Timeout | undefined
	private initWorkForceApiPromise?: { resolve: () => void; reject: (reason: any) => void }

	/**
	 * The WorkerStorage is a storage that the workers can use to reliably store and read data.
	 * It is a key-value store, with support for access locks (so that only one worker can write to a key at a time).
	 */
	private workerStorage: DataStore

	private logger: LoggerInstance

	constructor(logger: LoggerInstance, private config: AppContainerProcessConfig) {
		this.logger = logger.category('AppContainer')
		this.id = config.appContainer.appContainerId

		this.workerStorage = new DataStore(this.logger, WORKER_DATA_LOCK_TIMEOUT)

		if (config.appContainer.port !== null) {
			this.websocketServer = new WebsocketServer(
				config.appContainer.port,
				this.logger,
				(client: ClientConnection) => {
					try {
						// A new client has connected

						this.logger.debug(`New client "${client.clientType}" connected, id "${client.clientId}"`)

						switch (client.clientType) {
							case 'workerAgent': {
								const clientId = client.clientId as WorkerAgentId
								const workForceMethods = this.getWorkerAgentAPI(clientId)
								const api = new WorkerAgentAPI(this.id, workForceMethods, {
									type: 'websocket',
									clientConnection: client,
								})
								const app = this.apps.get(clientId)
								if (!app) {
									throw new Error(`Unknown app "${clientId}" just connected to the appContainer`)
								}
								client.once('close', () => {
									this.logger.warn(`Connection to Worker "${clientId}" closed`)
									app.workerAgentApi = null

									this.workerStorage.releaseLockForTag(unprotectString(clientId))
								})
								this.logger.info(`Connection to Worker "${client.clientId}" established`)
								app.workerAgentApi = api

								// Set upp the app for pinging and automatic spin-down:
								app.monitorPing = true
								app.lastPing = Date.now()
								api.setSpinDownTime(app.spinDownTime).catch((err) => {
									this.logger.error(`Error in spinDownTime: ${stringifyError(err)}`)
								})
								break
							}
							case 'expectationManager':
							case 'appContainer':
							case 'N/A':
								throw new Error(`ExpectationManager: Unsupported clientType "${client.clientType}"`)
							default:
								assertNever(client.clientType)
								throw new Error(`Workforce: Unknown clientType "${client.clientType}"`)
						}
					} catch (error) {
						this.logger.error(stringifyError(error))
					}
				}
			)
			this.websocketServer.on('error', (err: unknown) => {
				this.logger.error(`WebsocketServer error: ${stringifyError(err)}`)
			})
			this.websocketServer.on('close', () => {
				this.logger.error(`WebsocketServer closed`)
			})
		}

		this.workforceAPI = new WorkforceAPI(this.id, this.logger)
		this.workforceAPI.on('disconnected', () => {
			this.logger.warn('Workforce disconnected')
		})
		this.workforceAPI.on('connected', () => {
			this.logger.info('Workforce connected')

			this.workforceAPI
				.registerAvailableApps(
					mapEntries(this.availableApps, (appType: AppType) => {
						return { appType }
					})
				)
				.then(() => {
					this.initWorkForceApiPromise?.resolve() // To finish the init() function
				})
				.catch((err) => {
					this.logger.error(`Error in registerAvailableApps: ${stringifyError(err)}`)
					this.initWorkForceApiPromise?.reject(err)
				})
		})
		this.workforceAPI.on('error', (err) => {
			this.logger.error(`WorkforceAPI error event: ${stringifyError(err)}`)
		})

		this.workForceConnectionOptions = this.config.appContainer.workforceURL
			? {
					type: 'websocket',
					url: this.config.appContainer.workforceURL,
			  }
			: {
					type: 'internal',
			  }

		process.on('exit', (code) => {
			this.logger.info(`Closing with exitCode ${code}`)
			this.killAllApps()
		})
	}
	async init(): Promise<void> {
		await this.discoverAvailableApps()
		// Note: if we later change this.discoverAvailableApps to run on an interval
		// don't throw here:
		if (this.availableApps.size === 0) {
			throw new Error(`AppContainer found no apps upon init. (Check if there are any Worker executables?)`)
		}

		if (this.workForceConnectionOptions.type === 'websocket') {
			this.logger.info(`Connecting to Workforce at "${this.workForceConnectionOptions.url}"`)
		}

		await this.workforceAPI.init(
			this.workForceConnectionOptions,
			literal<Omit<WorkForceAppContainer.AppContainer, 'id'>>({
				setLogLevel: this.setLogLevel.bind(this),
				_debugKill: this._debugKill.bind(this),
				_debugSendKillConnections: this._debugSendKillConnections.bind(this),
				requestAppTypeForExpectation: this.requestAppTypeForExpectation.bind(this),
				requestAppTypeForPackageContainer: this.requestAppTypeForPackageContainer.bind(this),
				spinUp: this.spinUp.bind(this),
				spinDown: this.spinDown.bind(this),
				getRunningApps: this.getRunningApps.bind(this),
			})
		)
		if (!this.workforceAPI.connected) throw new Error('Workforce not connected')

		this.monitorAppsTimer = setInterval(() => {
			this.monitorApps()
		}, APPCONTAINER_PING_TIME)
		this.monitorApps() // Also run right away

		// Wait for the this.workforceAPI to be ready before continuing:
		await new Promise<void>((resolve, reject) => {
			this.initWorkForceApiPromise = { resolve, reject }
		})

		this.logger.info(`Initialized`)
	}
	/** Return the API-methods that the AppContainer exposes to the WorkerAgent */
	private getWorkerAgentAPI(clientId: WorkerAgentId): AppContainerWorkerAgent.AppContainer {
		return {
			id: clientId,
			ping: async (): Promise<void> => {
				const app = this.apps.get(clientId)
				if (app) app.lastPing = Date.now()
			},
			requestSpinDown: async (force?: boolean): Promise<void> => {
				const app = this.apps.get(clientId)
				if (!app) return

				if (force) {
					// The Worker is forcefully asking to be spun down.
					this.spinDown(clientId, `Forced by app`).catch((error) => {
						this.logger.error(`Error when spinning down app "${clientId}": ${stringifyError(error)}`)
					})
					// Note: this.monitorApps() will soon spin up another Worker if needed
				} else {
					// The Worker is kindly asking to be spun down.
					// The appcontainer will determine if it should be spun down.

					if (!app.isAutoScaling) return
					if (this.getAutoScalingAppCount(app.appType) > this.config.appContainer.minRunningApps) {
						this.spinDown(clientId, `Requested by app`).catch((error) => {
							this.logger.error(`Error when spinning down app "${clientId}": ${stringifyError(error)}`)
						})
					}
				}
			},
			workerStorageWriteLock: async (
				dataId: DataId,
				customTimeout?: number
			): Promise<{ lockId: LockId; current: any | undefined }> => {
				return this.workerStorage.getWriteLock(dataId, customTimeout, unprotectString(clientId))
			},
			workerStorageReleaseLock: async (dataId: DataId, lockId: LockId): Promise<void> => {
				return this.workerStorage.releaseLock(dataId, lockId)
			},
			workerStorageWrite: async (dataId: DataId, lockId: LockId, data: string): Promise<void> => {
				return this.workerStorage.write(dataId, lockId, data)
			},
			workerStorageRead: async (dataId: DataId): Promise<any> => {
				return this.workerStorage.read(dataId)
			},
		}
	}

	/** Returns the number of **auto-scaling** apps */
	private getAutoScalingAppCount(appType: AppType): number {
		let count = 0
		for (const app of this.apps.values()) {
			if (app.appType === appType && app.isAutoScaling) count++
		}
		return count
	}
	/** Returns the number of playout-critical apps */
	private getCriticalExpectationAppCount(appType: AppType): number {
		let count = 0
		for (const app of this.apps.values()) {
			if (app.appType === appType && app.isOnlyForCriticalExpectations) count++
		}
		return count
	}

	private async discoverAvailableApps() {
		const getWorkerArgs = (appId: AppId, pickUpCriticalExpectationsOnly: boolean): string[] => {
			return [
				// Set initial loglevel to be same as appContainer:
				`--logLevel=${getLogLevel()}`,

				`--workerId=${appId}`,
				pickUpCriticalExpectationsOnly ? `--pickUpCriticalExpectationsOnly=true` : '',
				`--workforceURL=${this.config.appContainer.workforceURL}`,
				`--appContainerURL=${'ws://127.0.0.1:' + this.websocketServer?.port}`,

				this.config.process.unsafeSSL ? '--unsafeSSL=true' : '',
				this.config.process.certificates.length
					? `--certificates=${this.config.process.certificates.join(';')}`
					: '',

				this.config.appContainer.worker.windowsDriveLetters
					? `--windowsDriveLetters=${this.config.appContainer.worker.windowsDriveLetters?.join(';')}`
					: '',
				this.config.appContainer.worker.costMultiplier
					? `--costMultiplier=${this.config.appContainer.worker.costMultiplier}`
					: '',
				this.config.appContainer.worker.considerCPULoad
					? `--considerCPULoad=${this.config.appContainer.worker.considerCPULoad}`
					: '',
				this.config.appContainer.worker.resourceId
					? `--resourceId=${this.config.appContainer.worker.resourceId}`
					: '',
				this.config.appContainer.worker.networkIds.length
					? `--networkIds=${this.config.appContainer.worker.networkIds.join(';')}`
					: '',
				this.config.appContainer.worker.failurePeriodLimit
					? `--failurePeriodLimit=${this.config.appContainer.worker.failurePeriodLimit}`
					: '',
				this.config.appContainer.worker.failurePeriod
					? `--failurePeriod=${this.config.appContainer.worker.failurePeriod}`
					: '',
			]
		}
		if (
			process.execPath.endsWith('node.exe') || // windows
			process.execPath.endsWith('node') // linux
		) {
			// Process runs as a node process, we're probably in development mode.
			const appType = protectString<AppType>('worker')
			this.availableApps.set(appType, {
				file: process.execPath,
				getExecArgs: (appId: AppId, useCriticalOnlyMode: boolean) => {
					return [
						path.resolve('.', '../../worker/app/dist/index.js'),
						...getWorkerArgs(appId, useCriticalOnlyMode),
					]
				},
				canRunInCriticalExpectationsOnlyMode: true,
				cost: 0,
			})
		} else {
			// Process is a compiled executable
			// Look for the worker executable(s) in the same folder:

			const dirPath = path.dirname(process.execPath)

			;(await fs.promises.readdir(dirPath)).forEach((fileName) => {
				if (!fileName.match(/worker/i)) return

				// We use the filename to identify the appType:
				const appType: AppType = protectString<AppType>(fileName)
				this.availableApps.set(appType, {
					file: path.join(dirPath, fileName),
					getExecArgs: (appId: AppId, useCriticalOnlyMode: boolean) => {
						return [...getWorkerArgs(appId, useCriticalOnlyMode)]
					},
					canRunInCriticalExpectationsOnlyMode: true,
					cost: 0,
				})
			})
		}

		this.logger.info(`Available apps`)
		for (const [appType, availableApp] of this.availableApps.entries()) {
			this.logger.info(`${appType}: ${availableApp.file}`)
		}
	}
	terminate(): void {
		this.workforceAPI.terminate()
		this.websocketServer?.terminate()
		this.workerStorage.terminate()

		if (this.monitorAppsTimer) {
			clearInterval(this.monitorAppsTimer)
			delete this.monitorAppsTimer
		}

		// kill child processes
	}
	async setLogLevel(logLevel: LogLevel): Promise<void> {
		this.logger.info(`Setting log level to "${logLevel}"`)
		setLogLevel(logLevel)
	}
	async _debugKill(): Promise<void> {
		// This is for testing purposes only
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(42)
		}, 1)
	}
	/** FOR DEBUGGING ONLY. Cut websocket connections, in order to ensure that they are restarted */
	async _debugSendKillConnections(): Promise<void> {
		this.workforceAPI.debugCutConnection()
	}

	async requestAppTypeForExpectation(
		exp: Expectation.Any
	): Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }> {
		this.logger.debug(`Got request for resources, for exp "${exp.id}"`)
		if (this.apps.size >= this.config.appContainer.maxRunningApps) {
			this.logger.debug(`Is already at our limit, no more resources available`)
			// If we're at our limit, we can't possibly run anything else
			return {
				success: false,
				reason: {
					user: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
					tech: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
				},
			}
		}

		if (this.availableApps.size === 0) {
			this.logger.error('No apps available')
		} else {
			this.logger.debug(`Available apps: ${Array.from(this.availableApps.keys()).join(', ')}`)
		}

		let lastNotSupportReason: ExpectedPackageStatusAPI.Reason = {
			user: 'No apps available',
			tech: 'No apps available',
		}
		for (const [appType, availableApp] of this.availableApps.entries()) {
			const runningApp = await this.getRunningOrSpawnScalingApp(appType)

			if (runningApp?.workerAgentApi) {
				const result = await runningApp.workerAgentApi.doYouSupportExpectation(exp)
				if (result.support) {
					return {
						success: true,
						appType: appType,
						cost: availableApp.cost,
					}
				} else {
					lastNotSupportReason = result.reason
					this.logger.silly(
						`App "${appType}": Does not support the expectation, reason: "${result.reason.tech}", cost: "${availableApp.cost}"`
					)
				}
			} else {
				this.logger.warn(`appType "${appType}" not available`)
			}
		}
		return {
			success: false,
			reason: {
				user: `No worker supports this expectation (reason: ${lastNotSupportReason?.user})`,
				tech: `No worker supports this expectation (one reason: ${lastNotSupportReason?.tech})`,
			},
		}
	}

	async requestAppTypeForPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<{ success: true; appType: AppType; cost: Cost } | { success: false; reason: Reason }> {
		this.logger.debug(`Got request for resources, for packageContainer "${packageContainer.id}"`)
		if (this.apps.size >= this.config.appContainer.maxRunningApps) {
			this.logger.debug(`Is already at our limit, no more resources available`)
			// If we're at our limit, we can't possibly run anything else
			return {
				success: false,
				reason: {
					user: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
					tech: `Is already at limit (${this.config.appContainer.maxRunningApps})`,
				},
			}
		}

		if (this.availableApps.size === 0) {
			this.logger.error('No apps available')
		} else {
			this.logger.debug(`Available apps: ${Array.from(this.availableApps.keys()).join(', ')}`)
		}

		for (const [appType, availableApp] of this.availableApps.entries()) {
			const runningApp = await this.getRunningOrSpawnScalingApp(appType)

			if (runningApp?.workerAgentApi) {
				const result = await runningApp.workerAgentApi.doYouSupportPackageContainer(packageContainer)
				if (result.support) {
					return {
						success: true,
						appType: appType,
						cost: availableApp.cost,
					}
				}
			} else {
				this.logger.warn(`appType "${appType}" not available`)
			}
		}
		return {
			success: false,
			reason: {
				user: `No worker supports this packageContainer`,
				tech: `No worker supports this packageContainer`,
			},
		}
	}

	private async getRunningOrSpawnScalingApp(appType: AppType): Promise<RunningAppInfo | undefined> {
		// Do we already have any instance of the appType running?
		let runningApp = findValue(this.apps, (_, app) => {
			if (!app.isAutoScaling) return false
			return app.appType === appType
		})

		if (!runningApp) {
			const newAppId = await this._spinUp(appType, true) // todo: make it not die too soon

			// wait for the app to connect to us:
			await tryAfewTimes(async () => {
				const app = this.apps.get(newAppId)
				if (!app) throw new Error(`Worker "${newAppId}" not found`)
				if (app.workerAgentApi) {
					return true
				}
				await waitTime(200)
				return false
			}, 10)
			runningApp = this.apps.get(newAppId)
			if (!runningApp) throw new Error(`Worker "${newAppId}" didn't connect in time`)
		}
		return runningApp
	}
	private getNewAppId(): AppId {
		const newAppId = protectString<AppId>(`${this.id}_${this.appId++}`)

		const existingApp = this.apps.get(newAppId)
		if (existingApp !== undefined) {
			throw new Error(
				`New AppId "${newAppId}" is still being used by an existing process, existing process is "${
					existingApp.appType
				}" and was started at: ${new Date(existingApp.start).toISOString()}`
			)
		}

		if (this.appId >= MAX_APP_ID) {
			this.logger.warn(`Resetting appId counter to 0, will start re-using old IDs`)
			this.appId = 0
		}

		return newAppId
	}
	async spinUp(appType: AppType): Promise<AppId> {
		return this._spinUp(appType)
	}
	private async _spinUp(
		appType: AppType,
		longSpinDownTime = false,
		isOnlyForCriticalExpectations = false
	): Promise<AppId> {
		const availableApp = this.availableApps.get(appType)
		if (!availableApp) throw new Error(`Unknown appType "${appType}"`)

		const appId = this.getNewAppId()

		this.logger.debug(`Spinning up app "${appId}" of type "${appType}"`)

		const child = this.setupChildProcess(appType, appId, availableApp, isOnlyForCriticalExpectations)

		let isAutoScaling = true
		if (isOnlyForCriticalExpectations) {
			isAutoScaling = false
		}

		let spinDownTime = this.config.appContainer.spinDownTime
		if (longSpinDownTime) {
			spinDownTime *= 10
		}
		if (!isAutoScaling) {
			// If not auto-scaling, disable the spinDownTime
			// (to reduce chatter and unnecessary requestSpinDown() calls )
			spinDownTime = 0
		}

		this.apps.set(appId, {
			process: child,
			appType: appType,
			toBeKilled: false,
			restarts: 0,
			lastRestart: 0,
			monitorPing: false,
			isAutoScaling: isAutoScaling,
			isOnlyForCriticalExpectations: isOnlyForCriticalExpectations,
			lastPing: Date.now(),
			spinDownTime: spinDownTime,
			workerAgentApi: null,
			start: Date.now(),
		})
		return appId
	}
	async spinDown(appId: AppId, reason: string): Promise<void> {
		const app = this.apps.get(appId)
		if (!app) throw new Error(`App "${appId}" not found`)

		this.logger.verbose(`Spinning down app "${appId}" due to: ${reason}`)

		app.toBeKilled = true
		const success = app.process.kill()
		if (!success) {
			this.logger.error(`Internal error: Killing of process "${app.process.pid}" failed`)
		}

		app.workerAgentApi = null
		app.process.removeAllListeners()
		this.apps.delete(appId)
	}
	/** This is used to kill all ChildProcesses when terminating */
	private killAllApps() {
		this.apps.forEach((app, appId) => {
			app.toBeKilled = true
			const success = app.process.kill()
			if (!success)
				this.logger.error(`Internal error: App "${appId}" (PID: ${app.process.pid}) could not be killed`)

			app.workerAgentApi = null
			app.process.removeAllListeners()
		})
		this.apps.clear()
	}
	async getRunningApps(): Promise<{ appId: AppId; appType: AppType }[]> {
		return mapEntries(this.apps, (appId, app) => {
			return {
				appId: appId,
				appType: app.appType,
			}
		})
	}
	private setupChildProcess(
		appType: AppType,
		appId: AppId,
		availableApp: AvailableAppInfo,
		useCriticalOnlyMode: boolean
	): cp.ChildProcess {
		const isRunningInDevelopmentMode = process.execPath.endsWith('node.exe') || process.execPath.endsWith('node')
		const cwd = isRunningInDevelopmentMode
			? undefined // Process runs as a node process, we're probably in development mode.
			: path.dirname(process.execPath) // Process runs as a node process, we're probably in development mode.

		let inspectPort: number | undefined = undefined
		if (isNodeRunningInDebugMode()) {
			// Also start child processes in debug mode:
			for (let i = 9100; i < 10000; i++) {
				if (!this.usedInspectPorts.has(i) && !this.busyPorts.has(i)) {
					inspectPort = i
					break
				}
			}
		}
		if (inspectPort) {
			this.logger.debug(`Child process will be started in debug mode with port ${inspectPort}`)
			this.usedInspectPorts.add(inspectPort)
		}

		const child = cp.spawn(availableApp.file, availableApp.getExecArgs(appId, useCriticalOnlyMode), {
			cwd: cwd,
			env: {
				...process.env,
				NODE_OPTIONS: inspectPort ? `--inspect=127.0.0.1:${inspectPort}` : undefined,
			},
		})

		this.logger.info(`Starting process "${appId}" (${appType}), pid=${child.pid}: "${availableApp.file}"`)

		child.stdout.on('data', (message) => {
			this.onOutputFromApp(appId, appType, message, this.logger.debug)
		})
		child.stderr.on('data', (message) => {
			this.onOutputFromApp(appId, appType, message, this.logger.error)
			// this.logger.debug(`${appId} stderr: ${message}`)
		})
		child.on('error', (err) => {
			this.logger.error(`PID=${child.pid} Error: ${stringifyError(err)}`)
			// TODO: handle errors better?

			try {
				// Try to kill the child process, if it isn't already dead:
				if (child.killed) child.kill()
			} catch (err) {
				this.logger.error(`Error when killing ${child.pid}: ${stringifyError(err)}`)
			}
		})
		child.once('exit', (code) => {
			if (inspectPort) this.usedInspectPorts.delete(inspectPort)
			const app = this.apps.get(appId)
			if (app) {
				if (!app.toBeKilled) {
					// Try to restart the application

					const timeUntilRestart = Math.max(0, app.lastRestart - Date.now() + RESTART_COOLDOWN)
					this.logger.warn(
						`App ${child.pid} (${appType}) closed with code (${code}), trying to restart in ${timeUntilRestart} ms (restarts: ${app.restarts})`
					)

					setTimeout(() => {
						app.lastRestart = Date.now()
						app.restarts++

						app.process.removeAllListeners()

						const newChild = this.setupChildProcess(appType, appId, availableApp, useCriticalOnlyMode)

						app.process = newChild
					}, timeUntilRestart)
				} else {
					this.logger.debug(`App ${app.process.pid} (${appType}) closed with code (${code})`)
				}
			} else {
				this.logger.warn(`Unexpected App ${child.pid} (${appType}) closed with code (${code})`)
			}
		})

		return child
	}
	private monitorApps() {
		for (const [appId, app] of this.apps.entries()) {
			if (app.monitorPing) {
				if (Date.now() - app.lastPing > APPCONTAINER_PING_TIME * 2.5) {
					// The app seems to have crashed.
					this.spinDown(appId, `Ping timeout`).catch((error) => {
						this.logger.error(`Error when spinning down app "${appId}": ${stringifyError(error)}`)
					})
				}
			}
			// try to avoid shutting down all workers at the same time
			const randomizeOffset = 2.5 * APPCONTAINER_PING_TIME * Math.random()
			if (Date.now() - app.start > this.config.appContainer.maxAppKeepalive + randomizeOffset) {
				this.spinDown(
					appId,
					`Lifetime exceeded Max KeepAlive for apps: ${this.config.appContainer.maxAppKeepalive}ms`
				).catch((error) => {
					this.logger.error(`Error when spinning down app "${appId}": ${stringifyError(error)}`)
				})
			}
		}

		this.spinUpMinimumApps().catch((error) => {
			this.logger.error(`Error in spinUpMinimumApps: ${stringifyError(error)}`)
		})
	}

	private async spinUpMinimumApps(): Promise<void> {
		if (this.config.appContainer.minCriticalWorkerApps > 0) {
			for (const [appType, appInfo] of this.availableApps.entries()) {
				if (!appInfo.canRunInCriticalExpectationsOnlyMode) continue

				while (this.getCriticalExpectationAppCount(appType) < this.config.appContainer.minCriticalWorkerApps) {
					await this._spinUp(appType, false, true)
				}
			}
		}

		for (const appType of this.availableApps.keys()) {
			while (this.getAutoScalingAppCount(appType) < this.config.appContainer.minRunningApps) {
				await this._spinUp(appType)
			}
		}
	}
	private onOutputFromApp(appId: AppId, appType: AppType, data: any, defaultLog: LeveledLogMethodLight): void {
		const messages = `${data}`.split('\n')

		for (const message of messages) {
			if (!message?.length) continue
			try {
				// Ignore some messages:
				if (message.indexOf('NODE_TLS_REJECT_UNAUTHORIZED') !== -1) {
					continue
				}

				// Handle an issue with busy ports:
				const m = `${message}`.match(/Starting inspector on 127.0.0.1:(\d+) failed/i)
				if (m) {
					const busyPort = parseInt(m[1])
					this.busyPorts.add(busyPort)
				}

				let parsedMessage: string | undefined = undefined
				let logLevel = ''
				let messageData: any = {}
				try {
					const json = JSON.parse(`${message}`)
					if (typeof json === 'object') {
						logLevel = json.level
						parsedMessage = `[${json.label}] ${json.message}`
						messageData = _.omit(json, ['message', 'localTimestamp', 'level'])
					}
				} catch {
					// There was an error parsing the message (the message probably wasn't JSON).
				}

				if (parsedMessage === undefined) {
					// [logLevel] [category] message
					const m = message.match(/^\[([^\]]+)\]\W\[([^\]]+)\]\W(.*)/)
					if (m) {
						logLevel = m[1]
						parsedMessage = `[${m[2]}] ${m[3]}`
					}
				}

				if (parsedMessage === undefined) {
					// Fall back to just just log the whole message:
					parsedMessage = `${message}`
				}

				const logLevels: { [key: string]: LeveledLogMethodLight } = {
					error: this.logger.error,
					warn: this.logger.warn,
					info: this.logger.info,
					debug: this.logger.debug,
					verbose: this.logger.verbose,
					silly: this.logger.silly,
				}
				const logFcn = logLevels[logLevel] || defaultLog
				logFcn(
					`App "${appId}" (${appType}): ${parsedMessage}`,
					_.isEmpty(messageData) ? undefined : messageData
				)
			} catch (err) {
				this.logger.error(stringifyError(err))
				// Fallback:
				defaultLog(`${appId} stdout: ${message}`)
			}
		}
	}
}
interface AvailableAppInfo {
	file: string
	getExecArgs: (appId: AppId, useCriticalOnlyMode: boolean) => string[]
	/** Whether the application can be spun up as a critical worker */
	canRunInCriticalExpectationsOnlyMode: boolean
	/** Some kind of value, how much it costs to run it, per minute */
	cost: Cost
}

interface RunningAppInfo {
	process: cp.ChildProcess
	appType: AppType
	/** Set to true if app should be considered for scaling down */
	isAutoScaling: boolean
	/** Set to true if the app is only handling playout-critical expectations */
	isOnlyForCriticalExpectations: boolean
	/** Set to true when the process is about to be killed */
	toBeKilled: boolean
	restarts: number
	lastRestart: number
	/**
	 * When an App has been idle for longer than the spinDownTime, if might request to be spun down
	 * (set to 0 to disable)
	 * [milliseconds]
	 */
	spinDownTime: number
	/** If null, there is no websocket connection to the app */
	workerAgentApi: WorkerAgentAPI | null
	monitorPing: boolean
	lastPing: number
	start: number
}

async function tryAfewTimes(cb: () => Promise<boolean>, maxTries: number) {
	for (let i = 0; i < maxTries; i++) {
		if (await cb()) {
			break
		}
	}
}
