import * as _ from 'underscore'
import { PeripheralDeviceAPI } from '@sofie-automation/server-core-integration'
import { CoreHandler } from './coreHandler'
import {
	Accessor,
	AccessorOnPackage,
	ExpectedPackage,
	ExpectedPackageStatusAPI,
	PackageContainer,
	PackageContainerOnPackage,
} from '@sofie-automation/blueprints-integration'
import { generateExpectations } from './expectationGenerator'
import { ExpectationManager } from '@shared/expectation-manager'
import {
	ClientConnectionOptions,
	Expectation,
	ServerConnectionOptions,
	ExpectationManagerWorkerAgent,
	PackageManagerConfig,
	LoggerInstance,
} from '@shared/api'
import * as deepExtend from 'deep-extend'
import clone = require('fast-clone')

export class PackageManagerHandler {
	private _coreHandler!: CoreHandler
	private _observers: Array<any> = []

	private _expectationManager: ExpectationManager

	private expectedPackageCache: { [id: string]: ExpectedPackageWrap } = {}
	private packageContainersCache: PackageContainers = {}

	private toReportExpectationStatus: { [id: string]: ExpectedPackageStatusAPI.WorkStatus } = {}
	private sendUpdateExpectationStatusTimeouts: { [id: string]: NodeJS.Timeout } = {}

	private toReportPackageStatus: { [id: string]: ExpectedPackageStatusAPI.PackageContainerPackageStatus } = {}
	private sendUpdatePackageContainerPackageStatusTimeouts: { [id: string]: NodeJS.Timeout } = {}

	private reportedStatuses: { [id: string]: ExpectedPackageStatusAPI.WorkStatus } = {}
	private externalData: { packageContainers: PackageContainers; expectedPackages: ExpectedPackageWrap[] } = {
		packageContainers: {},
		expectedPackages: [],
	}
	private _triggerUpdatedExpectedPackagesTimeout: NodeJS.Timeout | null = null

	constructor(
		public logger: LoggerInstance,
		private managerId: string,
		private serverConnectionOptions: ServerConnectionOptions,
		private serverAccessUrl: string | undefined,
		private workForceConnectionOptions: ClientConnectionOptions
	) {
		this._expectationManager = new ExpectationManager(
			this.logger,
			this.managerId,
			this.serverConnectionOptions,
			this.serverAccessUrl,
			this.workForceConnectionOptions,
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
			(
				containerId: string,
				packageId: string,
				packageStatus: ExpectedPackageStatusAPI.PackageContainerPackageStatus | null
			) => this.updatePackageContainerPackageStatus(containerId, packageId, packageStatus),
			(message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any) => this.onMessageFromWorker(message)
		)
	}

	async init(_config: PackageManagerConfig, coreHandler: CoreHandler): Promise<void> {
		this._coreHandler = coreHandler

		this._coreHandler.setPackageManagerHandler(this)

		this.logger.info('PackageManagerHandler init')

		// const peripheralDevice = await coreHandler.core.getPeripheralDevice()
		// const settings: TSRSettings = peripheralDevice.settings || {}

		coreHandler.onConnected(() => {
			this.setupObservers()
			// this.resendStatuses()
		})
		this.setupObservers()
		this.onSettingsChanged()
		this._triggerUpdatedExpectedPackages()

		await this.cleanReportedExpectations()
		await this._expectationManager.init()

		this.logger.info('PackageManagerHandler initialized')
	}
	onSettingsChanged(): void {
		// todo
	}
	getExpectationManager(): ExpectationManager {
		return this._expectationManager
	}
	setExternalData(packageContainers: PackageContainers, expectedPackages: ExpectedPackage.Any[]): void {
		const expectedPackagesWraps: ExpectedPackageWrap[] = []

		for (const expectedPackage of expectedPackages) {
			const combinedSources: PackageContainerOnPackage[] = []
			for (const packageSource of expectedPackage.sources) {
				const lookedUpSource: PackageContainer = packageContainers[packageSource.containerId]
				if (lookedUpSource) {
					// We're going to combine the accessor attributes set on the Package with the ones defined on the source:
					const combinedSource: PackageContainerOnPackage = {
						...omit(clone(lookedUpSource), 'accessors'),
						accessors: {},
						containerId: packageSource.containerId,
					}

					const accessorIds = _.uniq(
						Object.keys(lookedUpSource.accessors).concat(Object.keys(packageSource.accessors))
					)

					for (const accessorId of accessorIds) {
						const sourceAccessor = lookedUpSource.accessors[accessorId] as Accessor.Any | undefined

						const packageAccessor = packageSource.accessors[accessorId] as AccessorOnPackage.Any | undefined

						if (packageAccessor && sourceAccessor && packageAccessor.type === sourceAccessor.type) {
							combinedSource.accessors[accessorId] = deepExtend({}, sourceAccessor, packageAccessor)
						} else if (packageAccessor) {
							combinedSource.accessors[accessorId] = clone<AccessorOnPackage.Any>(packageAccessor)
						} else if (sourceAccessor) {
							combinedSource.accessors[accessorId] = clone<Accessor.Any>(
								sourceAccessor
							) as AccessorOnPackage.Any
						}
					}
					combinedSources.push(combinedSource)
				}
			}
			// Lookup Package targets:
			const combinedTargets: PackageContainerOnPackage[] = []

			for (const layer of expectedPackage.layers) {
				// Hack: we use the layer name as a 1-to-1 relation to a target containerId
				const packageContainerId: string = layer

				if (packageContainerId) {
					const lookedUpTarget = packageContainers[packageContainerId]
					if (lookedUpTarget) {
						// Todo: should the be any combination of properties here?
						combinedTargets.push({
							...omit(clone(lookedUpTarget), 'accessors'),
							accessors: lookedUpTarget.accessors as {
								[accessorId: string]: AccessorOnPackage.Any
							},
							containerId: packageContainerId,
						})
					}
				}
			}

			if (combinedSources.length) {
				if (combinedTargets.length) {
					expectedPackagesWraps.push({
						expectedPackage: expectedPackage,
						priority: 999,
						sources: combinedSources,
						targets: combinedTargets,
						playoutDeviceId: '',
						external: true,
					})
				}
			}
		}

		this.externalData = {
			packageContainers: packageContainers,
			expectedPackages: expectedPackagesWraps,
		}
		this._triggerUpdatedExpectedPackages()
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

		if (this._triggerUpdatedExpectedPackagesTimeout) {
			clearTimeout(this._triggerUpdatedExpectedPackagesTimeout)
			this._triggerUpdatedExpectedPackagesTimeout = null
		}

		this._triggerUpdatedExpectedPackagesTimeout = setTimeout(() => {
			this._triggerUpdatedExpectedPackagesTimeout = null
			this.logger.info('_triggerUpdatedExpectedPackages inner')

			const expectedPackages: ExpectedPackageWrap[] = []
			const packageContainers: PackageContainers = {}

			const objs = this._coreHandler.core.getCollection('deviceExpectedPackages').find(() => true)

			const activePlaylistObj = objs.find((o) => o.type === 'active_playlist')
			if (!activePlaylistObj) {
				this.logger.warn(`Collection objects active_playlist not found`)
				this.logger.info(`objs in deviceExpectedPackages:`, objs)
				return
			}
			const activePlaylist = activePlaylistObj.activeplaylist as ActivePlaylist
			const activeRundowns = activePlaylistObj.activeRundowns as ActiveRundown[]

			// Add from external data:
			{
				for (const expectedPackage of this.externalData.expectedPackages) {
					expectedPackages.push(expectedPackage)
				}
				Object.assign(packageContainers, this.externalData.packageContainers)
			}

			// Add from Core collections:
			{
				const expectedPackageObjs = objs.filter((o) => o.type === 'expected_packages')

				if (!expectedPackageObjs.length) {
					this.logger.warn(`Collection objects expected_packages not found`)
					this.logger.info(`objs in deviceExpectedPackages:`, objs)
					return
				}
				for (const expectedPackageObj of expectedPackageObjs) {
					for (const expectedPackage of expectedPackageObj.expectedPackages) {
						expectedPackages.push(expectedPackage)
					}
				}

				const packageContainerObj = objs.find((o) => o.type === 'package_containers')
				if (!packageContainerObj) {
					this.logger.warn(`Collection objects package_containers not found`)
					this.logger.info(`objs in deviceExpectedPackages:`, objs)
					return
				}
				Object.assign(packageContainers, packageContainerObj.packageContainers as PackageContainers)
			}

			this.handleExpectedPackages(packageContainers, activePlaylist, activeRundowns, expectedPackages)
		}, 300)
	}

	private handleExpectedPackages(
		packageContainers: PackageContainers,
		activePlaylist: ActivePlaylist,
		activeRundowns: ActiveRundown[],

		expectedPackages: ExpectedPackageWrap[]
	) {
		// Step 0: Save local cache:
		this.expectedPackageCache = {}
		this.packageContainersCache = packageContainers
		for (const exp of expectedPackages) {
			this.expectedPackageCache[exp.expectedPackage._id] = exp
		}

		this.logger.info('expectedPackages', expectedPackages)
		// this.logger.info(JSON.stringify(expectedPackages, null, 2))

		// Step 1: Generate expectations:
		const expectations = generateExpectations(
			this._expectationManager.managerId,
			this.packageContainersCache,
			activePlaylist,
			activeRundowns,
			expectedPackages
		)
		this.logger.info('expectations:', expectations)
		// this.logger.info(JSON.stringify(expectations, null, 2))

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
			if (!expectaction.statusReport.sendReport) return // Don't report the status

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
		packageStatus: ExpectedPackageStatusAPI.PackageContainerPackageStatus | null
	): void {
		const packageContainerPackageId = `${containerId}_${packageId}`
		if (!packageStatus) {
			delete this.toReportPackageStatus[packageContainerPackageId]
		} else {
			const o: ExpectedPackageStatusAPI.PackageContainerPackageStatus = {
				// Default properties:
				...{
					status: ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_READY,
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

		const toReportPackageStatus: ExpectedPackageStatusAPI.PackageContainerPackageStatus | null =
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
	private async onMessageFromWorker(
		message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any
	): Promise<any> {
		switch (message.type) {
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
				// @ts-expect-error message.type is never
				throw new Error(`Unsupported message type "${message.type}"`)
		}
	}
	public restartExpectation(workId: string): void {
		// This method can be called from core
		this._expectationManager.restartExpectation(workId)
	}
	public restartAllExpectations(): void {
		// This method can be called from core
		this._expectationManager.restartAllExpectations()
	}
	public abortExpectation(workId: string): void {
		// This method can be called from core
		this._expectationManager.abortExpectation(workId)
	}
}
export function omit<T, P extends keyof T>(obj: T, ...props: P[]): Omit<T, P> {
	return _.omit(obj, ...(props as string[])) as any
}

interface ResultingExpectedPackage {
	// This interface is copied from Core

	expectedPackage: ExpectedPackage.Base & { rundownId?: string }
	/** Lower should be done first */
	priority: number
	sources: PackageContainerOnPackage[]
	targets: PackageContainerOnPackage[]
	playoutDeviceId: string
	/** If set to true, this doesn't come from Core */
	external?: boolean
	// playoutLocation: any // todo?
}
export type ExpectedPackageWrap = ResultingExpectedPackage

export type PackageContainers = { [containerId: string]: PackageContainer }

export interface ActivePlaylist {
	_id: string
	active: boolean
	rehearsal: boolean
}
export interface ActiveRundown {
	_id: string
	_rank: number
}
