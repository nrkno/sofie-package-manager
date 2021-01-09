import { CoreHandler } from './coreHandler'
import { LoggerInstance } from './index'
import { ExpectedPackage, PackageOriginOnPackage } from '@sofie-automation/blueprints-integration'
import { generateExpectations } from './expectationGenerator'
import { ExpectationManager } from './expectationManager'

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PackageManagerConfig {}
export class PackageManagerHandler {
	logger: LoggerInstance
	private _coreHandler!: CoreHandler
	private _observers: Array<any> = []

	private _expectationManager: ExpectationManager

	constructor(logger: LoggerInstance) {
		this.logger = logger
		this._expectationManager = new ExpectationManager(this.logger)
	}

	async init(_config: PackageManagerConfig, coreHandler: CoreHandler): Promise<void> {
		this._coreHandler = coreHandler

		this._coreHandler.setPackageManagerHandler(this)

		this.logger.info('PackageManagerHandler init')

		await this._expectationManager.init()

		// const peripheralDevice = await coreHandler.core.getPeripheralDevice()
		// const settings: TSRSettings = peripheralDevice.settings || {}

		coreHandler.onConnected(() => {
			this.setupObservers()
			// this.resendStatuses()
		})
		this.setupObservers()

		this.onSettingsChanged()

		this._triggerUpdatedExpectedPackages()

		this.logger.info('PackageManagerHandler Done')
	}
	onSettingsChanged(): void {
		// todo
	}
	private setupObservers(): void {
		if (this._observers.length) {
			this.logger.debug('Clearing observers..')
			this._observers.forEach((obs) => {
				obs.stop()
			})
			this._observers = []
		}
		this.logger.info('Renewing observers')

		const expectedPackagesObserver = this._coreHandler.core.observe('deviceExpectedPackages')
		expectedPackagesObserver.added = () => {
			this._triggerUpdatedExpectedPackages()
		}
		expectedPackagesObserver.changed = () => {
			this._triggerUpdatedExpectedPackages()
		}
		expectedPackagesObserver.removed = () => {
			this._triggerUpdatedExpectedPackages()
		}
		this._observers.push(expectedPackagesObserver)
	}
	private _triggerUpdatedExpectedPackages() {
		this.logger.info('_triggerUpdatedExpectedPackages')

		const objs = this._coreHandler.core.getCollection('deviceExpectedPackages').find(() => true)

		this.logger.info(JSON.stringify(objs, null, 2))

		const expectedPackageObj = objs.find((o) => o.type === 'expected_packages')
		// const activePlaylistObj = objs.find((o) => o.type === 'active_playlist')

		if (!expectedPackageObj) {
			this.logger.warn(`Collection object expected_packages not found`)
			return
		}
		const expectedPackages = expectedPackageObj.expectedPackages as ExpectedPackageWrap[]
		// const packageOrigins = [] as PackageOriginMetadata.Any[] //TODO
		// const settings = {} // TODO

		this.handleExpectedPackages(expectedPackages)
	}

	private handleExpectedPackages(expectedPackages: ExpectedPackageWrap[]) {
		// Step 1: Generate expectations:
		const expectations = generateExpectations(expectedPackages)
		this.logger.info('expectations')
		this.logger.info(JSON.stringify(expectations, null, 2))

		// Step 2: Track and handle new expectations:
		this._expectationManager.updateExpectations(expectations)
	}
}

export interface ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.Any
	origins: PackageOriginOnPackage.Any[]
	playoutDeviceId: string
	playoutLocation: any
}
