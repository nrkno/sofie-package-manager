import {
	CoreConnection,
	CoreOptions,
	PeripheralDeviceAPI as P,
	DDPConnectorOptions,
	CollectionObj,
} from '@sofie-automation/server-core-integration'

import { DeviceConfig } from './connector'

import * as fs from 'fs'
import { LoggerInstance, PackageManagerConfig } from '@shared/api'

import { Process } from './process'
import { PACKAGE_MANAGER_DEVICE_CONFIG } from './configManifest'
import { PackageManagerHandler } from './packageManager'

export interface CoreConfig {
	host: string
	port: number
	watchdog: boolean
}
export interface PeripheralDeviceCommand {
	_id: string

	deviceId: string
	functionName: string
	args: Array<any>

	hasReply: boolean
	reply?: any
	replyError?: any

	time: number // time
}

/**
 * Represents a connection between the Gateway and Core
 */
export class CoreHandler {
	core!: CoreConnection
	logger: LoggerInstance
	public _observers: Array<any> = []
	public deviceSettings: { [key: string]: any } = {}

	public errorReporting = false
	public multithreading = false
	public reportAllCommands = false

	private _deviceOptions: DeviceConfig
	private _onConnected?: () => any
	private _executedFunctions: { [id: string]: boolean } = {}
	private _packageManagerHandler?: PackageManagerHandler
	private _coreConfig?: CoreConfig
	private _process?: Process

	private _statusInitialized = false
	private _statusDestroyed = false

	constructor(logger: LoggerInstance, deviceOptions: DeviceConfig) {
		this.logger = logger
		this._deviceOptions = deviceOptions
	}

	async init(config: PackageManagerConfig, process: Process): Promise<void> {
		// this.logger.info('========')
		this._statusInitialized = false
		this._coreConfig = {
			host: config.packageManager.coreHost,
			port: config.packageManager.corePort,
			watchdog: config.packageManager.disableWatchdog,
		}

		this._process = process

		this.core = new CoreConnection(this.getCoreConnectionOptions('Package manager', 'PackageManager'))

		this.core.onConnected(() => {
			this.logger.info('Core Connected!')
			this.setupObserversAndSubscriptions().catch((e) => {
				this.logger.error('Core Error during setupObserversAndSubscriptions:', e)
			})
			if (this._onConnected) this._onConnected()
		})
		this.core.onDisconnected(() => {
			this.logger.warn('Core Disconnected!')
		})
		this.core.onError((err) => {
			this.logger.error('Core Error: ' + (err.message || err.toString() || err))
		})

		const ddpConfig: DDPConnectorOptions = {
			host: this._coreConfig.host,
			port: this._coreConfig.port,
		}
		if (this._process && this._process.certificates.length) {
			ddpConfig.tlsOpts = {
				ca: this._process.certificates,
			}
		}

		await this.core.init(ddpConfig)
		this.logger.info('Core id: ' + this.core.deviceId)
		await this.setupObserversAndSubscriptions()
		this._statusInitialized = true
		await this.updateCoreStatus()
	}
	setPackageManagerHandler(handler: PackageManagerHandler): void {
		this._packageManagerHandler = handler
	}
	async setupObserversAndSubscriptions(): Promise<void> {
		this.logger.info('Core: Setting up subscriptions..')
		this.logger.info('DeviceId: ' + this.core.deviceId)
		await Promise.all([
			this.core.autoSubscribe('peripheralDevices', {
				_id: this.core.deviceId,
			}),
			this.core.autoSubscribe('studioOfDevice', this.core.deviceId),
			this.core.autoSubscribe('expectedPackagesForDevice', this.core.deviceId, undefined),
			// this.core.autoSubscribe('timelineForDevice', this.core.deviceId),
			this.core.autoSubscribe('peripheralDeviceCommands', this.core.deviceId),
		])

		this.logger.info('Core: Subscriptions are set up!')
		if (this._observers.length) {
			this.logger.info('CoreMos: Clearing observers..')
			this._observers.forEach((obs) => {
				obs.stop()
			})
			this._observers = []
		}
		// setup observers
		const observer = this.core.observe('peripheralDevices')
		observer.added = (id: string) => this.onDeviceChanged(id)
		observer.changed = (id: string) => this.onDeviceChanged(id)
		this.setupObserverForPeripheralDeviceCommands()
		return
	}
	async destroy(): Promise<void> {
		this._statusDestroyed = true
		await this.updateCoreStatus()
		await this.core.destroy()
	}
	getCoreConnectionOptions(name: string, subDeviceId: string): CoreOptions {
		let credentials: {
			deviceId: string
			deviceToken: string
		}

		if (this._deviceOptions.deviceId && this._deviceOptions.deviceToken) {
			credentials = {
				deviceId: this._deviceOptions.deviceId + subDeviceId,
				deviceToken: this._deviceOptions.deviceToken,
			}
		} else if (this._deviceOptions.deviceId) {
			this.logger.warn('Token not set, only id! This might be unsecure!')
			credentials = {
				deviceId: this._deviceOptions.deviceId + subDeviceId,
				deviceToken: 'unsecureToken',
			}
		} else {
			credentials = CoreConnection.getCredentials(subDeviceId)
		}
		const options: CoreOptions = {
			...credentials,

			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			deviceCategory: 'package_manager', //P.DeviceCategory.PACKAGE_MANAGER,
			deviceType: 'package_manager', // P.DeviceType.PACKAGE_MANAGER,
			deviceSubType: P.SUBTYPE_PROCESS,

			deviceName: name,
			watchDog: this._coreConfig ? this._coreConfig.watchdog : true,

			configManifest: PACKAGE_MANAGER_DEVICE_CONFIG,

			versions: this._getVersions(),
		}
		return options
	}
	onConnected(fcn: () => any): void {
		this._onConnected = fcn
	}
	onDeviceChanged(id: string): void {
		if (id === this.core.deviceId) {
			const col = this.core.getCollection('peripheralDevices')
			if (!col) throw new Error('collection "peripheralDevices" not found!')

			const device = col.findOne(id)
			if (device) {
				this.deviceSettings = device.settings || {}
			} else {
				this.deviceSettings = {}
			}

			const logLevel = this.deviceSettings['debugLogging'] ? 'debug' : 'info'
			if (logLevel !== this.logger.level) {
				this.logger.level = logLevel

				this.logger.info('Loglevel: ' + this.logger.level)

				// this.logger.debug('Test debug logging')
				// // @ts-ignore
				// this.logger.debug({ msg: 'test msg' })
				// // @ts-ignore
				// this.logger.debug({ message: 'test message' })
				// // @ts-ignore
				// this.logger.debug({ command: 'test command', context: 'test context' })

				// this.logger.debug('End test debug logging')
			}

			if (this.deviceSettings['errorReporting'] !== this.errorReporting) {
				this.errorReporting = this.deviceSettings['errorReporting']
			}
			if (this.deviceSettings['multiThreading'] !== this.multithreading) {
				this.multithreading = this.deviceSettings['multiThreading']
			}
			if (this.deviceSettings['reportAllCommands'] !== this.reportAllCommands) {
				this.reportAllCommands = this.deviceSettings['reportAllCommands']
			}

			if (this._packageManagerHandler) {
				this._packageManagerHandler.onSettingsChanged()
			}
		}
	}
	get logDebug(): boolean {
		return !!this.deviceSettings['debugLogging']
	}

	executeFunction(cmd: PeripheralDeviceCommand): void {
		if (cmd) {
			if (this._executedFunctions[cmd._id]) return // prevent it from running multiple times
			this.logger.debug(`Executing function "${cmd.functionName}", args: ${JSON.stringify(cmd.args)}`)
			this._executedFunctions[cmd._id] = true
			const cb = (err: any, res?: any) => {
				if (err) {
					this.logger.error('executeFunction error', err, err.stack)
				}
				this.core
					.callMethod(P.methods.functionReply, [cmd._id, err, res])
					.then(() => {
						// nothing
					})
					.catch((e) => {
						this.logger.error(e)
					})
			}
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			// eslint-disable-next-line @typescript-eslint/ban-types
			const fcn: Function = this[cmd.functionName]
			try {
				if (!fcn) throw Error('Function "' + cmd.functionName + '" not found!')

				Promise.resolve(fcn.apply(this, cmd.args))
					.then((result) => {
						cb(null, result)
					})
					.catch((e) => {
						cb(e.toString(), null)
					})
			} catch (e) {
				cb(e.toString(), null)
			}
		}
	}
	retireExecuteFunction(cmdId: string): void {
		delete this._executedFunctions[cmdId]
	}
	setupObserverForPeripheralDeviceCommands(): void {
		const observer = this.core.observe('peripheralDeviceCommands')
		this.killProcess(0)
		this._observers.push(observer)

		const addedChangedCommand = (id: string) => {
			const cmds = this.core.getCollection('peripheralDeviceCommands')
			if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')

			const cmd = cmds.findOne(id) as PeripheralDeviceCommand
			if (!cmd) throw Error('PeripheralCommand "' + id + '" not found!')

			if (cmd.deviceId === this.core.deviceId) {
				this.executeFunction(cmd)
			}
		}
		observer.added = (id: string) => {
			addedChangedCommand(id)
		}
		observer.changed = (id: string) => {
			addedChangedCommand(id)
		}
		observer.removed = (id: string) => {
			this.retireExecuteFunction(id)
		}
		const cmds = this.core.getCollection('peripheralDeviceCommands')
		if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')

		cmds.find({}).forEach((cmd0: CollectionObj) => {
			const cmd = cmd0 as PeripheralDeviceCommand
			if (cmd.deviceId === this.core.deviceId) {
				this.executeFunction(cmd)
			}
		})
	}
	killProcess(actually: number): boolean {
		if (actually === 1) {
			this.logger.info('KillProcess command received, shutting down in 1000ms!')
			setTimeout(() => {
				// eslint-disable-next-line no-process-exit
				process.exit(0)
			}, 1000)
			return true
		}
		return false
	}
	pingResponse(message: string): void {
		this.core.setPingResponse(message)
	}
	getSnapshot(): any {
		this.logger.info('getSnapshot')
		return {} // TODO: implement?
	}
	getDevicesInfo(): any {
		this.logger.info('getDevicesInfo')

		return []
		// const devices: any[] = []
		// if (this._tsrHandler) {
		// 	for (const device of this._tsrHandler.tsr.getDevices()) {
		// 		devices.push({
		// 			instanceId: device.instanceId,
		// 			deviceId: device.deviceId,
		// 			deviceName: device.deviceName,
		// 			startTime: device.startTime,
		// 			upTime: Date.now() - device.startTime,
		// 		})
		// 	}
		// }
		// return devices
	}
	updateCoreStatus(): Promise<any> {
		let statusCode = P.StatusCode.GOOD
		const messages: Array<string> = []

		if (!this._statusInitialized) {
			statusCode = P.StatusCode.BAD
			messages.push('Starting up...')
		}
		if (this._statusDestroyed) {
			statusCode = P.StatusCode.BAD
			messages.push('Shut down')
		}

		return this.core.setStatus({
			statusCode: statusCode,
			messages: messages,
		})
	}
	private _getVersions() {
		const versions: { [packageName: string]: string } = {}

		if (process.env.npm_package_version) {
			versions['_process'] = process.env.npm_package_version
		}

		const dirNames = ['@sofie-automation/server-core-integration']
		try {
			const nodeModulesDirectories = fs.readdirSync('node_modules')
			for (const dir of nodeModulesDirectories) {
				try {
					if (dirNames.indexOf(dir) !== -1) {
						let file = 'node_modules/' + dir + '/package.json'
						file = fs.readFileSync(file, 'utf8')
						const json = JSON.parse(file)
						versions[dir] = json.version || 'N/A'
					}
				} catch (e) {
					this.logger.error(e)
				}
			}
		} catch (e) {
			this.logger.error(e)
		}
		return versions
	}

	restartExpectation(workId: string): void {
		return this._packageManagerHandler?.restartExpectation(workId)
	}
	restartAllExpectations(): void {
		return this._packageManagerHandler?.restartAllExpectations()
	}
	abortExpectation(workId: string): void {
		return this._packageManagerHandler?.abortExpectation(workId)
	}
}
