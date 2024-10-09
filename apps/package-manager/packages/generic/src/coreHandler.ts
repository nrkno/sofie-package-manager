/* eslint-disable node/no-extraneous-import */
import {
	CoreConnection,
	CoreOptions,
	DDPConnectorOptions,
	Observer,
	Collection,
	CoreCredentials,
	StatusCode as SofieStatusCode,
	protectString,
	PeripheralDeviceId,
	PeripheralDeviceCommand,
	ExternalPeripheralDeviceAPI,
	PeripheralDeviceAPI,
	PeripheralDevicePubSub,
	PeripheralDevicePubSubCollectionsNames,
	PeripheralDevicePubSubCollections,
	CollectionDocCheck,
} from '@sofie-automation/server-core-integration'

import { DeviceConfig } from './connector'

import {
	LoggerInstance,
	PackageManagerConfig,
	ProcessHandler,
	StatusCode,
	Statuses,
	Status,
	stringifyError,
	hashObj,
	setLogLevel,
	getLogLevel,
	ensureValidValue,
	DEFAULT_LOG_LEVEL,
	ExpectationId,
	PackageContainerId,
	AppId,
} from '@sofie-package-manager/api'
import {
	DEFAULT_DELAY_REMOVAL_PACKAGE,
	DEFAULT_DELAY_REMOVAL_PACKAGE_INFO,
	PACKAGE_MANAGER_DEVICE_CONFIG,
} from './configManifest'
import { PackageManagerHandler } from './packageManager'
import { getCredentials } from './credentials'
import { FakeCore } from './fakeCore'
import { PeripheralDeviceCommandId } from '@sofie-automation/shared-lib/dist/core/model/Ids'

let packageJson: any
try {
	packageJson = require('../package.json')
} catch {
	packageJson = null
}

export interface CoreConfig {
	host: string
	port: number
	watchdog: boolean
}

/**
 * Represents a connection between the Gateway and Core
 */
export class CoreHandler {
	private logger: LoggerInstance
	public _observers: Array<Observer<any>> = []
	public deviceSettings: { [key: string]: any } = {}

	public delayRemoval = 0
	public delayRemovalPackageInfo = 0
	public useTemporaryFilePath = false
	public skipDeepScan = false
	public notUsingCore = false
	public fakeCore: FakeCore

	private core!: CoreConnection

	private _deviceOptions: DeviceConfig
	private _onConnected?: () => any
	private _executedFunctions = new Set<PeripheralDeviceCommandId>()
	private _packageManagerHandler?: PackageManagerHandler
	private _coreConfig?: CoreConfig
	private processHandler?: ProcessHandler

	private _statusInitialized = false
	private _statusDestroyed = false
	private statuses: Statuses = {}
	private reportedStatusHash = ''

	constructor(logger: LoggerInstance, deviceOptions: DeviceConfig) {
		this.logger = logger.category('CoreHandler')
		this._deviceOptions = deviceOptions

		this.fakeCore = new FakeCore(this.logger)
	}

	async init(config: PackageManagerConfig, processHandler: ProcessHandler): Promise<void> {
		// this.logger.info('========')
		this._statusInitialized = false
		this._coreConfig = {
			host: config.packageManager.coreHost,
			port: config.packageManager.corePort,
			watchdog: config.packageManager.disableWatchdog,
		}

		this.processHandler = processHandler

		this.core = new CoreConnection(this.getCoreConnectionOptions())

		this.core.onConnected(() => {
			this.logger.info('Core Connected!')
			if (this._onConnected) this._onConnected()
		})
		this.core.onDisconnected(() => {
			this.logger.warn('Core Disconnected!')
		})
		this.core.onError((err) => {
			this.logger.error('Core Error: ' + (typeof err === 'string' ? err : err.message || err.toString() || err))
		})

		const ddpConfig: DDPConnectorOptions = {
			host: this._coreConfig.host,
			port: this._coreConfig.port,
		}
		if (this.processHandler && this.processHandler.certificates.length) {
			ddpConfig.tlsOpts = {
				ca: this.processHandler.certificates,
			}
		}

		await this.core.init(ddpConfig)
		this.logger.info(`Core id:: ${this.core.deviceId}`)
		await this.setupObserversAndSubscriptions()
		this._statusInitialized = true
		await this.updateCoreStatus()

		const peripheralDevice = await this.core.getPeripheralDevice()
		this.logger.info(`Device studioId: "${peripheralDevice.studioId}"`)
		if (!peripheralDevice.studioId) {
			this.logger.warn('------------------------------------------------------')
			this.logger.warn('Not setup yet, exiting process!')
			this.logger.warn('To setup, go into Core and add this device to a Studio')
			this.logger.warn('------------------------------------------------------')
			process.exit(1) // eslint-disable-line no-process-exit
			return
		}
	}
	setNoCore(): void {
		// This is used when PackageManager is used as a standalone app
		this.notUsingCore = true
	}
	setPackageManagerHandler(handler: PackageManagerHandler): void {
		this._packageManagerHandler = handler
	}
	async setupObserversAndSubscriptions(): Promise<void> {
		this.logger.info('Core: Setting up subscriptions..')
		this.logger.info('DeviceId: ' + this.core.deviceId)
		await Promise.all([
			this.core.autoSubscribe(PeripheralDevicePubSub.peripheralDeviceForDevice, this.core.deviceId),
			this.core.autoSubscribe(PeripheralDevicePubSub.peripheralDeviceCommands, this.core.deviceId),
			this.core.autoSubscribe(PeripheralDevicePubSub.packageManagerPlayoutContext, this.core.deviceId, undefined),
			this.core.autoSubscribe(
				PeripheralDevicePubSub.packageManagerPackageContainers,
				this.core.deviceId,
				undefined
			),
			this.core.autoSubscribe(
				PeripheralDevicePubSub.packageManagerExpectedPackages,
				this.core.deviceId,
				undefined,
				undefined
			),
		])

		this.logger.info('Core: Subscriptions are set up!')

		// setup observers
		const observer = this.core.observe(PeripheralDevicePubSubCollectionsNames.peripheralDeviceForDevice)
		observer.added = (id: PeripheralDeviceId) => this.onDeviceChanged(id)
		observer.changed = (id: PeripheralDeviceId) => this.onDeviceChanged(id)
		this.setupObserverForPeripheralDeviceCommands()

		const peripheralDevices = this.core.getCollection(
			PeripheralDevicePubSubCollectionsNames.peripheralDeviceForDevice
		)
		if (peripheralDevices) {
			peripheralDevices.find({}).forEach((device) => {
				this.onDeviceChanged(device._id)
			})
		}
	}
	async destroy(): Promise<void> {
		if (this._observers.length) {
			this.logger.info('CoreMos: Clearing observers..')
			this._observers.forEach((obs) => {
				obs.stop()
			})
			this._observers = []
		}

		this._statusDestroyed = true
		await this.updateCoreStatus()
		await this.core.destroy()
	}
	getCoreConnectionOptions(): CoreOptions {
		const subDeviceId = 'PackageManager'
		let credentials: CoreCredentials

		if (this._deviceOptions.deviceId && this._deviceOptions.deviceToken) {
			credentials = {
				deviceId: protectString(this._deviceOptions.deviceId + subDeviceId),
				deviceToken: this._deviceOptions.deviceToken,
			}
		} else if (this._deviceOptions.deviceId) {
			this.logger.warn('Token not set, only id! This might be unsecure!')
			credentials = {
				deviceId: protectString(this._deviceOptions.deviceId + subDeviceId),
				deviceToken: 'unsecureToken',
			}
		} else {
			credentials = getCredentials(subDeviceId)
		}
		const options: CoreOptions = {
			...credentials,

			deviceCategory: PeripheralDeviceAPI.PeripheralDeviceCategory.PACKAGE_MANAGER,
			deviceType: PeripheralDeviceAPI.PeripheralDeviceType.PACKAGE_MANAGER,

			deviceName: 'Package manager',
			watchDog: this._coreConfig ? this._coreConfig.watchdog : true,

			configManifest: PACKAGE_MANAGER_DEVICE_CONFIG,

			documentationUrl: 'https://github.com/nrkno/sofie-package-manager',

			versions: this._getVersions(),
		}
		return options
	}
	onConnected(fcn: () => any): void {
		this._onConnected = fcn
	}
	onDeviceChanged(id: PeripheralDeviceId): void {
		if (id === this.core.deviceId) {
			const col = this.core.getCollection(PeripheralDevicePubSubCollectionsNames.peripheralDeviceForDevice)
			if (!col) throw new Error('collection "peripheralDeviceForDevice" not found!')

			const device = col.findOne(id)
			this.deviceSettings = device?.deviceSettings || {}

			const logLevel = this.deviceSettings['logLevel'] ?? DEFAULT_LOG_LEVEL
			if (logLevel !== getLogLevel()) {
				setLogLevel(logLevel)

				this.logger.info('Loglevel: ' + getLogLevel())

				// this.logger.debug('Test debug logging')
				// this.logger.verbose('Test verbose')
				// this.logger.info('Test info')
				// this.logger.warn('Test warn')
				// this.logger.error('Test error')
				// this.logger.debug({ msg: 'test msg' })
				// this.logger.debug({ message: 'test message' })
				// this.logger.debug({ command: 'test command', context: 'test context' })
				// this.logger.error('Testing error', new Error('This is the error'))

				// this.logger.debug('End test debug logging')
			}

			if (this.deviceSettings['delayRemoval'] !== this.delayRemoval) {
				this.delayRemoval = ensureValidValue<number>(
					Number(this.deviceSettings['delayRemoval']),
					(input: any) => Number(input) >= 0,
					DEFAULT_DELAY_REMOVAL_PACKAGE
				)
			}
			if (this.deviceSettings['delayRemovalPackageInfo'] !== this.delayRemovalPackageInfo) {
				this.delayRemovalPackageInfo = ensureValidValue<number>(
					Number(this.deviceSettings['delayRemovalPackageInfo']),
					(input: any) => Number(input) >= 0,
					DEFAULT_DELAY_REMOVAL_PACKAGE_INFO
				)
			}
			if (this.deviceSettings['useTemporaryFilePath'] !== this.useTemporaryFilePath) {
				this.useTemporaryFilePath = this.deviceSettings['useTemporaryFilePath']
			}
			if (this.deviceSettings['skipDeepScan'] !== this.skipDeepScan) {
				this.skipDeepScan = this.deviceSettings['skipDeepScan']
			}

			if (this._packageManagerHandler) {
				this._packageManagerHandler.onSettingsChanged()
			}
		}
	}

	executeFunction(cmd: PeripheralDeviceCommand): void {
		if (cmd) {
			if (this._executedFunctions.has(cmd._id)) return // prevent it from running multiple times

			// Ignore specific commands, to reduce noise:
			if (cmd.functionName !== 'getExpetationManagerStatus') {
				this.logger.debug(`Executing function "${cmd.functionName}", args: ${JSON.stringify(cmd.args)}`)
			}

			this._executedFunctions.add(cmd._id)
			const cb = (err: any, res?: any) => {
				if (err) {
					this.logger.error(`executeFunction error: ${stringifyError(err)}`)
				}
				this.core.coreMethods
					.functionReply(cmd._id, err, res)
					.then(() => {
						// nothing
					})
					.catch((e) => {
						this.logger.error(
							`(Replying to ${
								cmd.functionName
							}) Error when calling method functionReply: ${stringifyError(e)}`
						)
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
						cb(`${stringifyError(e)}`, null)
					})
			} catch (e) {
				cb(`${stringifyError(e)}`, null)
			}
		}
	}
	retireExecuteFunction(cmdId: PeripheralDeviceCommandId): void {
		this._executedFunctions.delete(cmdId)
	}
	observe(collectionName: keyof PeripheralDevicePubSubCollections): Observer<any> {
		if (!this.core && this.notUsingCore) throw new Error('core.observe called, even though notUsingCore is true.')
		if (!this.core) throw new Error('Core not initialized!')
		return this.core.observe(collectionName)
	}

	// getCollection<K extends keyof PubSubCollections>(collectionName: K): Collection<CollectionDocCheck<PubSubCollections[K]>>;

	// getCollection<
	// 	DBObj extends {
	// 		_id: CoreProtectedString<any> | string
	// 	} = never
	// >(collectionName: keyof PeripheralDevicePubSubCollections): Collection<DBObj> {
	getCollection<K extends keyof PeripheralDevicePubSubCollections>(
		collectionName: K
	): Collection<CollectionDocCheck<PeripheralDevicePubSubCollections[K]>> {
		if (!this.core && this.notUsingCore) throw new Error('core.observe called, even though notUsingCore is true.')
		if (!this.core) throw new Error('Core not initialized!')
		return this.core.getCollection(collectionName)
	}

	get coreMethods(): ExternalPeripheralDeviceAPI {
		if (!this.core && this.notUsingCore) throw new Error('core.observe called, even though notUsingCore is true.')
		if (!this.core) throw new Error('Core not initialized!')
		return this.core.coreMethods
	}
	get coreConnected(): boolean {
		return this.core?.connected || false
	}
	private setupObserverForPeripheralDeviceCommands(): void {
		const observer = this.core.observe(PeripheralDevicePubSubCollectionsNames.peripheralDeviceCommands)
		this._observers.push(observer)

		const addedChangedCommand = (id: PeripheralDeviceCommandId) => {
			const cmds = this.core.getCollection(PeripheralDevicePubSubCollectionsNames.peripheralDeviceCommands)
			if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')

			const cmd = cmds.findOne(id)
			if (!cmd) throw Error('PeripheralCommand "' + id + '" not found!')

			if (cmd.deviceId === this.core.deviceId) {
				this.executeFunction(cmd)
			}
		}
		observer.added = (id: PeripheralDeviceCommandId) => {
			addedChangedCommand(id)
		}
		observer.changed = (id: PeripheralDeviceCommandId) => {
			addedChangedCommand(id)
		}
		observer.removed = (id: PeripheralDeviceCommandId) => {
			this.retireExecuteFunction(id)
		}
		const cmds = this.core.getCollection(PeripheralDevicePubSubCollectionsNames.peripheralDeviceCommands)
		if (!cmds) throw Error('"peripheralDeviceCommands" collection not found!')

		cmds.find({}).forEach((cmd) => {
			if (cmd.deviceId === this.core.deviceId) {
				this.executeFunction(cmd)
			}
		})
	}
	killProcess(): void {
		this.logger.info('KillProcess command received, shutting down in 1000ms!')
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(0)
		}, 1000)
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
	}
	async setStatus(statuses: Statuses): Promise<any> {
		this.statuses = statuses
		await this.updateCoreStatus()
	}
	private async updateCoreStatus(): Promise<any> {
		let statusCode = SofieStatusCode.GOOD
		const messages: Array<string> = []

		if (!this._statusInitialized) {
			statusCode = SofieStatusCode.BAD
			messages.push('Starting up...')
		}
		if (this._statusDestroyed) {
			statusCode = SofieStatusCode.BAD
			messages.push('Shut down')
		}

		if (statusCode === SofieStatusCode.GOOD) {
			for (const [statusId, status] of Object.entries<Status | null>(this.statuses)) {
				if (status && status.statusCode !== StatusCode.GOOD) {
					statusCode = Math.max(statusCode, status.statusCode)
					messages.push(`${status.message} ("${statusId}")`)
				}
			}
		}

		const statusHash = hashObj({ statusCode, messages })
		if (this.reportedStatusHash !== statusHash) {
			this.reportedStatusHash = statusHash

			await this.core.setStatus({
				statusCode: statusCode,
				messages: messages,
			})
		}
	}
	private _getVersions(): { [packageName: string]: string } {
		const versions: { [packageName: string]: string } = {}

		versions['_process'] = process.env.npm_package_version || packageJson?.version || 'N/A'

		return versions
	}

	restartExpectation(workId: ExpectationId): void {
		return this._packageManagerHandler?.restartExpectation(workId)
	}
	restartAllExpectations(): void {
		return this._packageManagerHandler?.restartAllExpectations()
	}
	abortExpectation(workId: ExpectationId): void {
		return this._packageManagerHandler?.abortExpectation(workId)
	}
	restartPackageContainer(containerId: PackageContainerId): void {
		return this._packageManagerHandler?.restartPackageContainer(containerId)
	}
	troubleshoot(): any {
		return this._packageManagerHandler?.getDataSnapshot()
	}
	async getExpetationManagerStatus(): Promise<any> {
		return this._packageManagerHandler?.getExpetationManagerStatus()
	}
	async debugKillApp(appId: AppId): Promise<void> {
		return this._packageManagerHandler?.debugKillApp(appId)
	}
}
