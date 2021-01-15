import * as _ from 'underscore'
import { PeripheralDeviceAPI } from '@sofie-automation/server-core-integration'
import { CoreHandler } from './coreHandler'
import { LoggerInstance } from './index'
import {
	ExpectedPackage,
	ExpectedPackageStatusAPI,
	PackageContainerOnPackage,
} from '@sofie-automation/blueprints-integration'
import { generateExpectations } from './expectationGenerator'
import { ExpectationManager } from './expectationManager'
import { Expectation } from './worker/expectationApi'

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PackageManagerConfig {}
export class PackageManagerHandler {
	logger: LoggerInstance
	private _coreHandler!: CoreHandler
	private _observers: Array<any> = []

	private _expectationManager: ExpectationManager
	private expectedPackageCache: { [id: string]: ExpectedPackageWrap } = {}
	private toReportStatuses: { [id: string]: ExpectedPackageStatusAPI.WorkStatus } = {}
	private sendUpdateExpectationStatusTimeouts: { [id: string]: NodeJS.Timeout } = {}
	private reportedStatuses: { [id: string]: ExpectedPackageStatusAPI.WorkStatus } = {}

	constructor(logger: LoggerInstance) {
		this.logger = logger
		this._expectationManager = new ExpectationManager(
			this.logger,
			(
				expectationId: string,
				expectaction: Expectation.Any | null,
				statusInfo: {
					status?: string
					progress?: number
					statusReason?: string
				}
			) => this.updateExpectationStatus(expectationId, expectaction, statusInfo)
		)
	}

	async init(_config: PackageManagerConfig, coreHandler: CoreHandler): Promise<void> {
		this._coreHandler = coreHandler

		this._coreHandler.setPackageManagerHandler(this)

		this.logger.info('PackageManagerHandler init')

		await this.cleanReportedExpectations()

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
		// const settings = {} // TODO

		this.handleExpectedPackages(expectedPackages)
	}

	private handleExpectedPackages(expectedPackages: ExpectedPackageWrap[]) {
		// Step 0: Save local cache:
		this.expectedPackageCache = {}
		for (const exp of expectedPackages) {
			this.expectedPackageCache[exp.expectedPackage._id] = exp
		}

		this.logger.info('expectedPackages')
		this.logger.info(JSON.stringify(expectedPackages, null, 2))

		// Step 1: Generate expectations:
		const expectations = generateExpectations(expectedPackages)
		this.logger.info('expectations:')
		this.logger.info(JSON.stringify(expectations, null, 2))

		// Step 2: Track and handle new expectations:
		this._expectationManager.updateExpectations(expectations)
	}
	public updateExpectationStatus(
		expectationId: string,
		expectaction: Expectation.Any | null,
		statusInfo: {
			status?: string
			progress?: number
			statusReason?: string
		}
	): void {
		if (!expectaction) {
			delete this.toReportStatuses[expectationId]
		} else {
			const packageStatus: ExpectedPackageStatusAPI.WorkStatus = {
				// Default properties:
				...{
					status: 'N/A',
					progress: 0,
					statusReason: '',
				},
				// Previous properties:
				...(this.toReportStatuses[expectationId] || {}),
				// Updated porperties:
				...expectaction.statusReport,
				...statusInfo,
			}

			this.toReportStatuses[expectationId] = packageStatus

			this.triggerSendUpdateExpectationStatus(expectationId)
		}
	}
	private triggerSendUpdateExpectationStatus(expectationId: string) {
		if (!this.sendUpdateExpectationStatusTimeouts[expectationId]) {
			this.sendUpdateExpectationStatusTimeouts[expectationId] = setTimeout(() => {
				delete this.sendUpdateExpectationStatusTimeouts[expectationId]
				this.sendUpdateExpectationStatus(expectationId)
			}, 300)
		}
	}
	private sendUpdateExpectationStatus(expectationId: string) {
		const toReportStatus = this.toReportStatuses[expectationId]

		if (!toReportStatus && this.reportedStatuses[expectationId]) {
			this._coreHandler.core
				.callMethod(PeripheralDeviceAPI.methods.removeExpectedPackageWorkStatus, [expectationId])
				.catch((err) => {
					this.logger.error('Error when calling method removeExpectedPackageStatus:')
					this.logger.error(err)
				})
			delete this.reportedStatuses[expectationId]
		} else {
			// const expWrap = this.expectedPackageCache[expectaction.statusReport.packageId]
			// if (!expWrap) return // If the expectedPackage isn't found, we shouldn't send any updates

			const lastReportedStatus = this.reportedStatuses[expectationId]

			if (!lastReportedStatus) {
				this._coreHandler.core
					.callMethod(PeripheralDeviceAPI.methods.insertExpectedPackageWorkStatus, [
						expectationId,
						toReportStatus,
					])
					.catch((err) => {
						this.logger.error('Error when calling method insertExpectedPackageStatus:')
						this.logger.error(err)
					})
			} else {
				const mod: Partial<ExpectedPackageStatusAPI.WorkStatus> = {}
				for (const key of Object.keys(toReportStatus)) {
					// @ts-expect-error no index signature found
					if (toReportStatus[key] !== lastReportedStatus[key]) {
						// @ts-expect-error no index signature found
						mod[key] = toReportStatus[key]
					}
				}
				if (!_.isEmpty(mod)) {
					// Send partial update:
					this._coreHandler.core
						.callMethod(PeripheralDeviceAPI.methods.updateExpectedPackageWorkStatus, [expectationId, mod])
						.then((okResult) => {
							if (!okResult) {
								// Retry with sending full update
								return this._coreHandler.core.callMethod(
									PeripheralDeviceAPI.methods.insertExpectedPackageWorkStatus,
									[expectationId, toReportStatus]
								)
							}
							return Promise.resolve()
						})
						.catch((err) => {
							this.logger.error('Error when calling method updateExpectedPackageStatus:')
							this.logger.error(err)
						})
				}
			}
			this.reportedStatuses[expectationId] = {
				...toReportStatus,
			}
		}
	}
	private async cleanReportedExpectations() {
		await this._coreHandler.core.callMethod(
			PeripheralDeviceAPI.methods.removeAllExpectedPackageWorkStatusOfDevice,
			[]
		)
	}
}

interface ResultingExpectedPackage {
	// This is copied from Core
	expectedPackage: ExpectedPackage.Base
	sources: PackageContainerOnPackage[]
	targets: PackageContainerOnPackage[]
	playoutDeviceId: string
	// playoutLocation: any // todo?
}
export type ExpectedPackageWrap = ResultingExpectedPackage
