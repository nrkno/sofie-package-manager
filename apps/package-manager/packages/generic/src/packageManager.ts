import * as _ from 'underscore'
import { PeripheralDeviceAPI } from '@sofie-automation/server-core-integration'
import { CoreHandler } from './coreHandler'
import { LoggerInstance } from './index'
import {
	ExpectedPackage,
	ExpectedPackageStatusAPI,
	PackageContainer,
	PackageContainerOnPackage,
} from '@sofie-automation/blueprints-integration'
import { generateExpectations } from './expectationGenerator'
import { ExpectationManager } from './expectationManager'
import { Expectation } from '@shared/api'
import { MessageFromWorkerPayload } from '@shared/worker'

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PackageManagerConfig {}
export class PackageManagerHandler {
	logger: LoggerInstance
	private _coreHandler!: CoreHandler
	private _observers: Array<any> = []

	private _expectationManager: ExpectationManager

	private expectedPackageCache: { [id: string]: ExpectedPackageWrap } = {}
	private packageContainersCache: PackageContainers = {}

	private toReportExpectationStatus: { [id: string]: ExpectedPackageStatusAPI.WorkStatus } = {}
	private sendUpdateExpectationStatusTimeouts: { [id: string]: NodeJS.Timeout } = {}

	private toReportPackageStatus: { [id: string]: PackageContainerPackageStatus } = {}
	private sendUpdatePackageContainerPackageStatusTimeouts: { [id: string]: NodeJS.Timeout } = {}

	private reportedStatuses: { [id: string]: ExpectedPackageStatusAPI.WorkStatus } = {}

	constructor(logger: LoggerInstance) {
		this.logger = logger
		this._expectationManager = new ExpectationManager(
			this.logger,
			(
				expectationId: string,
				expectaction: Expectation.Any | null,
				actualVersionHash: string | null,
				statusInfo: {
					status?: string
					progress?: number
					statusReason?: string
				}
			) => this.updateExpectationStatus(expectationId, expectaction, actualVersionHash, statusInfo),
			(containerId: string, packageId: string, packageStatus: PackageContainerPackageStatus | null) =>
				this.updatePackageContainerPackageStatus(containerId, packageId, packageStatus),
			(message: MessageFromWorkerPayload) => this.onMessageFromWorker(message)
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
		const packageContainers = expectedPackageObj.packageContainers as PackageContainers
		// const settings = {} // TODO

		this.handleExpectedPackages(packageContainers, expectedPackages)
	}

	private handleExpectedPackages(packageContainers: PackageContainers, expectedPackages: ExpectedPackageWrap[]) {
		// Step 0: Save local cache:
		this.expectedPackageCache = {}
		this.packageContainersCache = packageContainers
		for (const exp of expectedPackages) {
			this.expectedPackageCache[exp.expectedPackage._id] = exp
		}

		this.logger.info('expectedPackages')
		this.logger.info(JSON.stringify(expectedPackages, null, 2))

		// Step 1: Generate expectations:
		const expectations = generateExpectations(this.packageContainersCache, expectedPackages)
		this.logger.info('expectations:')
		this.logger.info(JSON.stringify(expectations, null, 2))

		// Step 2: Track and handle new expectations:
		this._expectationManager.updateExpectations(expectations)
	}
	public updateExpectationStatus(
		expectationId: string,
		expectaction: Expectation.Any | null,
		actualVersionHash: string | null,
		statusInfo: {
			status?: string
			progress?: number
			statusReason?: string
		}
	): void {
		if (!expectaction) {
			delete this.toReportExpectationStatus[expectationId]
		} else {
			const packageStatus: ExpectedPackageStatusAPI.WorkStatus = {
				// Default properties:
				...{
					status: 'N/A',
					progress: 0,
					statusReason: '',
				},
				// Previous properties:
				...(((this.toReportExpectationStatus[expectationId] || {}) as any) as Record<string, unknown>), // Intentionally cast to Any, to make typings in const packageStatus more strict
				// Updated porperties:
				...expectaction.statusReport,
				...statusInfo,

				fromPackages: expectaction.fromPackages.map((fromPackage) => {
					const prevPromPackage = this.toReportExpectationStatus[expectationId]?.fromPackages.find(
						(p) => p.id === fromPackage.id
					)
					return {
						id: fromPackage.id,
						expectedContentVersionHash: fromPackage.expectedContentVersionHash,
						actualContentVersionHash: actualVersionHash || prevPromPackage?.actualContentVersionHash || '',
					}
				}),
			}

			this.toReportExpectationStatus[expectationId] = packageStatus
		}
		this.triggerSendUpdateExpectationStatus(expectationId)
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
		const toReportStatus = this.toReportExpectationStatus[expectationId]

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
	public updatePackageContainerPackageStatus(
		containerId: string,
		packageId: string,
		packageStatus: PackageContainerPackageStatus | null
	): void {
		const packageContainerPackageId = `${containerId}_${packageId}`
		if (!packageStatus) {
			delete this.toReportPackageStatus[packageContainerPackageId]
		} else {
			const o: PackageContainerPackageStatus = {
				// Default properties:
				...{
					status: PackageContainerPackageStatusStatus.NOT_READY,
					progress: 0,
					statusReason: '',
				},
				// Previous properties:
				...(((this.toReportPackageStatus[packageContainerPackageId] || {}) as any) as Record<string, unknown>), // Intentionally cast to Any, to make typings in const packageStatus more strict
				// Updated porperties:
				...packageStatus,
			}

			this.toReportPackageStatus[packageContainerPackageId] = o
		}
		this.triggerSendUpdatePackageContainerPackageStatus(containerId, packageId)
	}
	private triggerSendUpdatePackageContainerPackageStatus(containerId: string, packageId: string): void {
		const packageContainerPackageId = `${containerId}_${packageId}`
		if (!this.sendUpdatePackageContainerPackageStatusTimeouts[packageContainerPackageId]) {
			this.sendUpdatePackageContainerPackageStatusTimeouts[packageContainerPackageId] = setTimeout(() => {
				delete this.sendUpdatePackageContainerPackageStatusTimeouts[packageContainerPackageId]
				this.sendUpdatePackageContainerPackageStatus(containerId, packageId)
			}, 300)
		}
	}
	public sendUpdatePackageContainerPackageStatus(containerId: string, packageId: string): void {
		const packageContainerPackageId = `${containerId}_${packageId}`

		const toReportPackageStatus: PackageContainerPackageStatus | null =
			this.toReportPackageStatus[packageContainerPackageId] || null

		this._coreHandler.core
			.callMethod(PeripheralDeviceAPI.methods.updatePackageContainerPackageStatus, [
				containerId,
				packageId,
				toReportPackageStatus,
			])
			.catch((err) => {
				this.logger.error('Error when calling method removeExpectedPackageStatus:')
				this.logger.error(err)
			})
	}
	private async onMessageFromWorker(message: MessageFromWorkerPayload): Promise<any> {
		switch (message.type) {
			case 'updatePackageContainerPackageStatus':
				return await this._coreHandler.core.callMethod(
					PeripheralDeviceAPI.methods.updatePackageContainerPackageStatus,
					message.arguments
				)
			case 'fetchPackageInfoMetadata':
				return await this._coreHandler.core.callMethod(
					PeripheralDeviceAPI.methods.fetchPackageInfoMetadata,
					message.arguments
				)
			case 'updatePackageInfo':
				return await this._coreHandler.core.callMethod(
					PeripheralDeviceAPI.methods.updatePackageInfo,
					message.arguments
				)
			case 'removePackageInfo':
				return await this._coreHandler.core.callMethod(
					PeripheralDeviceAPI.methods.removePackageInfo,
					message.arguments
				)
			default:
				throw new Error(`Unsupported message type "${message.type}"`)
		}
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
export interface PackageContainerPackageStatus extends Omit<ExpectedPackageStatusAPI.WorkStatusInfo, 'status'> {
	// This is copied from Core
	status: PackageContainerPackageStatusStatus

	contentVersionHash: string

	/* Progress (0-1), used when status = TRANSFERRING */
	progress: number
	/** Calculated time left, used when status = TRANSFERRING */
	expectedLeft?: number

	/** Longer reason as to why the status is what it is */
	statusReason: string
}
export enum PackageContainerPackageStatusStatus {
	NOT_READY = 'not_ready',
	TRANSFERRING = 'transferring',
	READY = 'ready',
}
export type PackageContainers = { [containerId: string]: PackageContainer }
