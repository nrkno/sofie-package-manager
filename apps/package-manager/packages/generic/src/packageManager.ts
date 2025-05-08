import _ from 'underscore'
import { CoreHandler } from './coreHandler'
// eslint-disable-next-line node/no-extraneous-import
import {
	ExpectedPackageStatusAPI,
	ExpectedPackage as ExpectedPackageOrg,
} from '@sofie-automation/shared-lib/dist/package-manager/package'
import {
	ExpectedPackageId as CoreExpectedPackageId,
	ExpectedPackageWorkStatusId,
} from '@sofie-automation/shared-lib/dist/core/model/Ids'
import {
	PackageManagerActivePlaylist,
	PackageManagerActiveRundown,
	PackageManagerExpectedPackageBase,
	// eslint-disable-next-line node/no-extraneous-import
} from '@sofie-automation/shared-lib/dist/package-manager/publications'
import {
	Observer,
	PeripheralDeviceId,
	PeripheralDevicePubSubCollectionsNames,
} from '@sofie-automation/server-core-integration'
// eslint-disable-next-line node/no-extraneous-import
import { UpdateExpectedPackageWorkStatusesChanges } from '@sofie-automation/shared-lib/dist/peripheralDevice/methodsAPI'
// eslint-disable-next-line node/no-extraneous-import
import {
	ExpectationManager,
	ExpectationManagerCallbacks,
	ExpectationManagerServerOptions,
} from '@sofie-package-manager/expectation-manager'
import {
	ExpectedPackage,
	PackageContainer,
	PackageContainerOnPackage,
	StatusCode,
	ClientConnectionOptions,
	Expectation,
	ExpectationManagerWorkerAgent,
	PackageManagerConfig,
	LoggerInstance,
	PackageContainerExpectation,
	literal,
	Reason,
	deepEqual,
	stringifyError,
	Accessor,
	AccessorOnPackage,
	Statuses,
	Status,
	ExpectationManagerId,
	PackageContainerId,
	ExpectedPackageId,
	ExpectationId,
	MonitorId,
	AppId,
	AccessorId,
	AnyProtectedString,
	objectEntries,
	objectSize,
	ProtectedString,
	protectString,
	unprotectString,
	convProtectedString,
	objectKeys,
	objectValues,
	mapToObject,
} from '@sofie-package-manager/api'
import deepExtend from 'deep-extend'
import clone = require('fast-clone')
import { GenerateExpectationApi } from './generateExpectations/api'
import { PackageManagerSettings } from './generated/options'

import * as NRK from './generateExpectations/nrk'
import { startTimer } from '@sofie-package-manager/api'

export class PackageManagerHandler {
	public coreHandler!: CoreHandler
	private _observers: Array<any> = []

	public expectationManager: ExpectationManager

	public packageContainersCache: PackageContainers = {}

	private externalData: { packageContainers: PackageContainers; expectedPackages: ExpectedPackageWrap[] } = {
		packageContainers: {},
		expectedPackages: [],
	}
	private _triggerUpdatedExpectedPackagesTimeout: NodeJS.Timeout | null = null
	public monitoredPackages: Map<PackageContainerId, Map<MonitorId, ExpectedPackageWrap[]>> = new Map()
	settings: PackageManagerSettings = {}
	callbacksHandler: ExpectationManagerCallbacksHandler

	private dataSnapshot: {
		updated: number
		expectedPackages: ExpectedPackageWrap[]
		packageContainers: PackageContainers
		expectations: { [id: ExpectationId]: Expectation.Any }
		packageContainerExpectations: { [id: PackageContainerId]: PackageContainerExpectation }
	} = {
		updated: 0,
		expectedPackages: [],
		packageContainers: {},
		expectations: {},
		packageContainerExpectations: {},
	}

	private expectationGeneratorApi: GenerateExpectationApi

	private logger: LoggerInstance
	constructor(
		logger: LoggerInstance,
		private managerId: ExpectationManagerId,
		private serverOptions: ExpectationManagerServerOptions,
		private serverAccessUrl: string | undefined,
		private workForceConnectionOptions: ClientConnectionOptions,
		concurrency: number | undefined,
		chaosMonkey: boolean
	) {
		this.logger = logger.category('PackageManager')
		this.callbacksHandler = new ExpectationManagerCallbacksHandler(this.logger, this)

		this.expectationManager = new ExpectationManager(
			this.logger,
			this.managerId,
			this.serverOptions,
			this.serverAccessUrl,
			this.workForceConnectionOptions,
			this.callbacksHandler,
			{
				chaosMonkey: chaosMonkey,
				constants: {
					PARALLEL_CONCURRENCY: concurrency,
				},
			}
		)

		this.expectationGeneratorApi = NRK.api
	}

	async init(_config: PackageManagerConfig, coreHandler: CoreHandler): Promise<void> {
		this.coreHandler = coreHandler

		this.coreHandler.setPackageManagerHandler(this)

		this.logger.info('PackageManagerHandler init')

		coreHandler.onConnected(() => {
			this.setupObservers()

			// Trigger a send of status updates:
			this.callbacksHandler.onCoreConnected()
		})
		this.setupObservers()
		this.onSettingsChanged()
		this.triggerUpdatedExpectedPackages()

		await this.callbacksHandler.cleanReportedStatuses()
		await this.expectationManager.init()

		this.logger.info('PackageManagerHandler initialized')
	}
	onSettingsChanged(): void {
		this.settings = {
			delayRemoval: this.coreHandler.delayRemoval,
			delayRemovalPackageInfo: this.coreHandler.delayRemovalPackageInfo,
			useTemporaryFilePath: this.coreHandler.useTemporaryFilePath,
			skipDeepScan: this.coreHandler.skipDeepScan,
		}
		this.triggerUpdatedExpectedPackages()
	}
	getExpectationManager(): ExpectationManager {
		return this.expectationManager
	}

	setExternalData(packageContainers: PackageContainers, expectedPackages: ExpectedPackage.Any[]): void {
		const expectedPackagesWraps: ExpectedPackageWrap[] = []

		for (const expectedPackage of expectedPackages) {
			const wrap = wrapExpectedPackage(packageContainers, expectedPackage)
			if (wrap) {
				expectedPackagesWraps.push(wrap)
			}
		}

		this.externalData = {
			packageContainers: packageContainers,
			expectedPackages: expectedPackagesWraps,
		}
		this.triggerUpdatedExpectedPackages()
	}
	private setupObservers(): void {
		if (this._observers.length) {
			this.logger.debug('Clearing observers..')
			this._observers.forEach((obs) => {
				obs.stop()
			})
			this._observers = []
		}
		if (this.coreHandler.notUsingCore) return // Abort if we are not using core
		this.logger.debug('Renewing observers')

		const triggerUpdateOnAnyChange = (observer: Observer<any>) => {
			observer.added = () => {
				this.triggerUpdatedExpectedPackages()
			}
			observer.changed = () => {
				this.triggerUpdatedExpectedPackages()
			}
			observer.removed = () => {
				this.triggerUpdatedExpectedPackages()
			}
			this._observers.push(observer)
		}

		triggerUpdateOnAnyChange(
			this.coreHandler.observe(PeripheralDevicePubSubCollectionsNames.packageManagerExpectedPackages)
		)
		triggerUpdateOnAnyChange(
			this.coreHandler.observe(PeripheralDevicePubSubCollectionsNames.packageManagerPlayoutContext)
		)
		triggerUpdateOnAnyChange(
			this.coreHandler.observe(PeripheralDevicePubSubCollectionsNames.packageManagerPackageContainers)
		)
		triggerUpdateOnAnyChange(
			this.coreHandler.observe(PeripheralDevicePubSubCollectionsNames.packageManagerExpectedPackages)
		)
	}
	public triggerUpdatedExpectedPackages(): void {
		if (this._triggerUpdatedExpectedPackagesTimeout) {
			clearTimeout(this._triggerUpdatedExpectedPackagesTimeout)
			this._triggerUpdatedExpectedPackagesTimeout = null
		}

		this._triggerUpdatedExpectedPackagesTimeout = setTimeout(() => {
			this._triggerUpdatedExpectedPackagesTimeout = null

			const timer = startTimer()

			const packageContainers: PackageContainers = {}
			const expectedPackageSources: {
				sourceName: string
				expectedPackages: ExpectedPackageWrap[]
			}[] = []

			let activePlaylist: PackageManagerActivePlaylist | null = null
			let activeRundowns: PackageManagerActiveRundown[] = []

			// Add from external data:
			{
				const expectedPackagesExternal: ExpectedPackageWrap[] = []
				for (const expectedPackage of this.externalData.expectedPackages) {
					expectedPackagesExternal.push(expectedPackage)
				}
				Object.assign(packageContainers, this.externalData.packageContainers)
				if (expectedPackagesExternal.length > 0) {
					expectedPackageSources.push({
						sourceName: 'external',
						expectedPackages: expectedPackagesExternal,
					})
				}
			}

			if (!this.coreHandler.notUsingCore) {
				const playoutContextObj = this.coreHandler
					.getCollection(PeripheralDevicePubSubCollectionsNames.packageManagerPlayoutContext)
					.find()[0]
				if (playoutContextObj) {
					activePlaylist = playoutContextObj.activePlaylist
					activeRundowns = playoutContextObj.activeRundowns
				} else {
					this.logger.warn(`packageManagerPlayoutContext collection object not found`)
					return
				}

				const packageContainersObj = this.coreHandler
					.getCollection(PeripheralDevicePubSubCollectionsNames.packageManagerPackageContainers)
					.find()[0]
				if (packageContainersObj) {
					Object.assign(packageContainers, packageContainersObj.packageContainers)
				} else {
					this.logger.warn(`packageManagerPackageContainers collection object not found`)
					return
				}

				// Add from Core collections:
				const expectedPackagesObjs = this.coreHandler
					.getCollection(PeripheralDevicePubSubCollectionsNames.packageManagerExpectedPackages)
					.find()

				const expectedPackagesCore: ExpectedPackageWrap[] = []
				for (const expectedPackagesObj of expectedPackagesObjs) {
					expectedPackagesCore.push(expectedPackagesObj as any as ExpectedPackageWrap)
				}
				if (expectedPackagesCore.length > 0) {
					expectedPackageSources.push({
						sourceName: 'core',
						expectedPackages: expectedPackagesCore,
					})
				}
			}

			// Add from Monitors:
			{
				for (const monitors of this.monitoredPackages.values()) {
					for (const [monitorId, monitorExpectedPackages] of monitors.entries()) {
						expectedPackageSources.push({
							sourceName: `monitor_${monitorId}`,
							expectedPackages: monitorExpectedPackages,
						})
					}
				}
			}

			this.handleExpectedPackages(packageContainers, activePlaylist, activeRundowns, expectedPackageSources)

			this.logger.silly(`Took ${timer.get()} ms to handle updated expectedPackages`)
		}, 300)
	}

	private handleExpectedPackages(
		packageContainers: PackageContainers,
		activePlaylist: PackageManagerActivePlaylist | null,
		activeRundowns: PackageManagerActiveRundown[],

		expectedPackageSources: {
			sourceName: string
			expectedPackages: ExpectedPackageWrap[]
		}[]
	) {
		const expectedPackages: ExpectedPackageWrap[] = []
		for (const expectedPackageSource of expectedPackageSources) {
			for (const exp of expectedPackageSource.expectedPackages) {
				expectedPackages.push(exp)
			}
		}

		// Step 0: Save local cache:
		this.packageContainersCache = packageContainers

		this.logger.debug(
			`Has ${expectedPackages.length} expectedPackages (${expectedPackageSources
				.map((s) => `${s.sourceName}: ${s.expectedPackages.length}`)
				.join(', ')})`
		)
		this.logger.silly(JSON.stringify(expectedPackages, null, 2))
		// this.logger.debug(JSON.stringify(expectedPackages, null, 2))

		this.dataSnapshot.expectedPackages = expectedPackages
		this.dataSnapshot.packageContainers = this.packageContainersCache

		// Step 1: Generate expectations:
		const expectations = this.expectationGeneratorApi.getExpectations(
			this.logger,
			this.expectationManager.managerId,
			this.packageContainersCache,
			activePlaylist,
			activeRundowns,
			expectedPackages,
			this.settings
		)
		this.logger.debug(`Has ${objectSize(expectations)} expectations`)
		this.logger.silly(JSON.stringify(expectations, null, 2))
		// this.logger.debug(JSON.stringify(expectations, null, 2))
		this.dataSnapshot.expectations = expectations

		this.logger.debug(`Has ${Object.keys(this.packageContainersCache).length} packageContainers`)
		this.logger.silly(JSON.stringify(this.packageContainersCache, null, 2))
		const packageContainerExpectations = this.expectationGeneratorApi.getPackageContainerExpectations(
			this.expectationManager.managerId,
			this.packageContainersCache,
			activePlaylist
		)
		this.logger.debug(`Has ${objectSize(packageContainerExpectations)} packageContainerExpectations`)
		this.logger.silly(JSON.stringify(packageContainerExpectations, null, 2))
		this.dataSnapshot.packageContainerExpectations = packageContainerExpectations
		this.dataSnapshot.updated = Date.now()

		this.ensureMandatoryPackageContainerExpectations(packageContainerExpectations)

		// Step 2: Track and handle new expectations:
		this.expectationManager.updatePackageContainerExpectations(packageContainerExpectations)

		this.expectationManager.updateExpectations(expectations)
	}
	public restartExpectation(workId: ExpectationId): void {
		// This method can be called from core
		this.expectationManager.restartExpectation(workId)
	}
	public restartAllExpectations(): void {
		// This method can be called from core
		this.expectationManager.restartAllExpectations()
	}
	public abortExpectation(workId: ExpectationId): void {
		// This method can be called from core
		this.expectationManager.abortExpectation(workId)
	}
	public restartPackageContainer(containerId: PackageContainerId): void {
		// This method can be called from core
		this.expectationManager.restartPackageContainer(containerId)
	}
	public getDataSnapshot(): any {
		return {
			...this.dataSnapshot,

			reportedStatuses: {
				reportedExpectationStatuses: mapToObject(this.callbacksHandler.reportedExpectationStatuses),
				reportedPackageStatuses: mapToObject(this.callbacksHandler.reportedPackageStatuses),
				reportedPackageContainerStatuses: mapToObject(this.callbacksHandler.reportedPackageContainerStatuses),
			},
			expectationManager: this.expectationManager.getTroubleshootData(),
		}
	}
	public async getExpetationManagerStatus(): Promise<any> {
		return {
			...(await this.expectationManager.getStatusReport()),
			packageManager: {
				workforceURL:
					this.workForceConnectionOptions.type === 'websocket' ? this.workForceConnectionOptions.url : null,
				lastUpdated: this.dataSnapshot.updated,
				countExpectedPackages: this.dataSnapshot.expectedPackages.length,
				countPackageContainers: objectSize(this.dataSnapshot.packageContainers),
				countExpectations: objectSize(this.dataSnapshot.expectations),
				countPackageContainerExpectations: objectSize(this.dataSnapshot.packageContainerExpectations),
			},
			updated: Date.now(),
		}
	}
	public async debugKillApp(appId: AppId): Promise<void> {
		return this.expectationManager.debugKillApp(appId)
	}

	/** Ensures that the packageContainerExpectations contains the mandatory expectations */
	private ensureMandatoryPackageContainerExpectations(packageContainerExpectations: {
		[id: PackageContainerId]: PackageContainerExpectation
	}): void {
		for (const [containerId, packageContainer] of objectEntries<PackageContainerId, PackageContainer>(
			this.packageContainersCache
		)) {
			/** Is the Container writeable */
			let isWriteable = false
			for (const accessor of objectValues(packageContainer.accessors)) {
				if (accessor.allowWrite) {
					isWriteable = true
					break
				}
			}
			if (!packageContainerExpectations[containerId]) {
				// Add default packageContainerExpectation:
				// All packageContainers should get a default expectation, so that statuses are reported back.
				packageContainerExpectations[containerId] = literal<PackageContainerExpectation>({
					...packageContainer,
					id: containerId,
					managerId: this.expectationManager.managerId,
					cronjobs: {},
					monitors: {},
				})
			}
			if (isWriteable) {
				// All writeable packageContainers should have the clean-up cronjob:
				const existing = packageContainerExpectations[containerId] as PackageContainerExpectation | undefined
				if (existing && !existing.cronjobs.cleanup) {
					// Add cronjob to clean up:
					existing.cronjobs.cleanup = {
						label: 'Clean up old packages',
					}
				}
			}
		}
	}
}
export function omit<T, P extends keyof T>(obj: T, ...props: P[]): Omit<T, P> {
	return _.omit(obj, ...(props as string[])) as any
}

/** This class handles data and requests that comes from ExpectationManager. */
class ExpectationManagerCallbacksHandler implements ExpectationManagerCallbacks {
	private logger: LoggerInstance

	private triggerSendUpdatedStatusesTimeout: NodeJS.Timeout | undefined
	private sendUpdatedStatusesIsRunning = false
	private sendUpdatedStatusesRunAgain = false

	private increment = 1

	private toReportExpectationStatuses: ReportStatuses<
		ExpectationId,
		ExpectedPackageStatusAPI.WorkStatus | null,
		undefined
	> = new Map()
	public reportedExpectationStatuses: ReportStatuses<ExpectationId, ExpectedPackageStatusAPI.WorkStatus, undefined> =
		new Map()

	private toReportPackageStatus: ReportStatuses<
		PackageOnPackageId,
		ExpectedPackageStatusAPI.PackageContainerPackageStatus | null,
		{ containerId: PackageContainerId; packageId: ExpectedPackageId }
	> = new Map()
	public reportedPackageStatuses: ReportStatuses<
		PackageOnPackageId,
		ExpectedPackageStatusAPI.PackageContainerPackageStatus,
		{ containerId: PackageContainerId; packageId: ExpectedPackageId }
	> = new Map()

	private toReportPackageContainerStatus: ReportStatuses<
		PackageContainerId,
		ExpectedPackageStatusAPI.PackageContainerStatus | null,
		undefined
	> = new Map()
	public reportedPackageContainerStatuses: ReportStatuses<
		PackageContainerId,
		ExpectedPackageStatusAPI.PackageContainerStatus,
		undefined
	> = new Map()
	private expectationManagerStatuses: Statuses = {}

	constructor(logger: LoggerInstance, private packageManager: PackageManagerHandler) {
		this.logger = logger.category('ExpectationManagerCallbacksHandler')
	}

	public reportExpectationStatus(
		expectationId: ExpectationId,
		expectation: Expectation.Any | null,
		actualVersionHash: string | null,
		statusInfo: {
			status?: ExpectedPackageStatusAPI.WorkStatusState
			progress?: number
			priority?: number
			statusReason?: Reason
			prevStatusReasons?: { [state: string]: Reason }
		}
	): void {
		if (!expectation) {
			if (this.toReportExpectationStatuses.has(expectationId)) {
				this.updateExpectationStatus(expectationId, null)
			}
		} else {
			if (!expectation.statusReport.sendReport) return // Don't report the status

			const previouslyReported = this.toReportExpectationStatuses.get(expectationId)?.status

			// Remove undefined properties, so they don't mess with the spread operators below:
			deleteAllUndefinedProperties(expectation.statusReport)
			deleteAllUndefinedProperties(statusInfo)

			const workStatus: ExpectedPackageStatusAPI.WorkStatus = {
				// Default properties:
				...{
					status: ExpectedPackageStatusAPI.WorkStatusState.NEW,
					statusChanged: 0,
					progress: 0,
					priority: 9999,
					statusReason: { user: '', tech: '' },
					prevStatusReasons: {},
				},
				// Previous properties:
				...((previouslyReported || {}) as Partial<ExpectedPackageStatusAPI.WorkStatus>), // Intentionally cast to Partial<>, to make typings in const workStatus more strict

				// Updated properties:
				...expectation.statusReport,
				requiredForPlayout: expectation.workOptions.requiredForPlayout ?? false,
				...statusInfo,

				fromPackages: expectation.fromPackages.map((fromPackage) => {
					const fromPackageId = unprotectString(fromPackage.id)
					const prevPromPackage = this.toReportExpectationStatuses
						.get(expectationId)
						?.status?.fromPackages.find((p) => p.id === fromPackageId)
					return {
						id: fromPackageId,
						expectedContentVersionHash: fromPackage.expectedContentVersionHash,
						actualContentVersionHash: actualVersionHash || prevPromPackage?.actualContentVersionHash || '',
					}
				}),
			}

			// Update statusChanged:
			workStatus.statusChanged = previouslyReported?.statusChanged || Date.now()
			if (
				workStatus.status !== previouslyReported?.status ||
				workStatus.progress !== previouslyReported?.progress
				// (not checking statusReason, as that should not affect statusChanged)
			) {
				workStatus.statusChanged = Date.now()
			}

			this.updateExpectationStatus(expectationId, workStatus)
		}
	}
	public reportPackageContainerPackageStatus(
		containerId: PackageContainerId,
		packageId: ExpectedPackageId,
		packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
	): void {
		const packageContainerPackageId = packageOnPackageId(containerId, packageId)
		if (!packageStatus) {
			this.updatePackageContainerPackageStatus(containerId, packageId, null)
		} else {
			const previouslyReported = this.toReportPackageStatus.get(packageContainerPackageId)?.status

			const containerStatus: ExpectedPackageStatusAPI.PackageContainerPackageStatus = {
				// Default properties:
				...{
					status: ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_READY,
					progress: 0,
					statusChanged: 0,
					statusReason: { user: '', tech: '' },
				},
				// pre-existing properties:
				...((previouslyReported || {}) as Partial<ExpectedPackageStatusAPI.PackageContainerPackageStatus>), // Intentionally cast to Partial<>, to make typings in const containerStatus more strict
				// Updated properties:
				...packageStatus,
			}

			// Update statusChanged:
			containerStatus.statusChanged = previouslyReported?.statusChanged || Date.now()
			if (
				containerStatus.status !== previouslyReported?.status ||
				containerStatus.progress !== previouslyReported?.progress
				// (not checking statusReason, as that should not affect statusChanged)
			) {
				containerStatus.statusChanged = Date.now()
			}

			this.updatePackageContainerPackageStatus(containerId, packageId, containerStatus)
		}
	}
	public reportPackageContainerExpectationStatus(
		containerId: PackageContainerId,
		statusInfo: ExpectedPackageStatusAPI.PackageContainerStatus | null
	): void {
		if (!statusInfo) {
			this.updatePackageContainerStatus(containerId, null)
		} else {
			const previouslyReported = this.toReportPackageContainerStatus.get(containerId)?.status

			const containerStatus: ExpectedPackageStatusAPI.PackageContainerStatus = {
				// Default properties:
				...{
					status: StatusCode.UNKNOWN,
					statusReason: {
						user: '',
						tech: '',
					},
					statusChanged: 0,

					monitors: {},
				},
				// pre-existing properties:
				...((previouslyReported || {}) as Partial<ExpectedPackageStatusAPI.PackageContainerStatus>), // Intentionally cast to Partial<>, to make typings in const containerStatus more strict
				// Updated properties:
				...statusInfo,
			}

			// Update statusChanged:
			containerStatus.statusChanged = previouslyReported?.statusChanged || Date.now()
			if (!deepEqual(containerStatus, previouslyReported)) {
				containerStatus.statusChanged = Date.now()
				this.updatePackageContainerStatus(containerId, containerStatus)
			}
		}
	}
	public reportManagerStatus(statuses: Statuses): void {
		this.expectationManagerStatuses = statuses
		this.triggerReportUpdatedStatuses()
	}

	public async messageFromWorker(message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any): Promise<any> {
		switch (message.type) {
			case 'fetchPackageInfoMetadata': {
				return this.getCoreMethods().fetchPackageInfoMetadata(
					message.arguments[0],
					convProtectedString<ExpectedPackageId[], CoreExpectedPackageId[]>(message.arguments[1])
				)
			}
			case 'updatePackageInfo': {
				return this.getCoreMethods().updatePackageInfo(
					message.arguments[0],
					convProtectedString<ExpectedPackageId, CoreExpectedPackageId>(message.arguments[1]),
					message.arguments[2],
					message.arguments[3],
					message.arguments[4]
				)
			}
			case 'removePackageInfo': {
				return this.getCoreMethods().removePackageInfo(
					message.arguments[0],
					convProtectedString<ExpectedPackageId, CoreExpectedPackageId>(message.arguments[1]),
					message.arguments[2]
				)
			}
			case 'reportFromMonitorPackages':
				this.onReportMonitoredPackages(...message.arguments)
				break

			default:
				// @ts-expect-error message is never
				throw new Error(`Unsupported message type "${message.type}"`)
		}
	}
	public async cleanReportedStatuses() {
		// Clean out all reported statuses, this is an easy way to sync a clean state with core

		this.reportedExpectationStatuses = new Map()
		await this.getCoreMethods().removeAllExpectedPackageWorkStatusOfDevice()

		this.reportedPackageContainerStatuses = new Map()
		await this.getCoreMethods().removeAllPackageContainerPackageStatusesOfDevice()

		this.reportedPackageStatuses = new Map()
		await this.getCoreMethods().removeAllPackageContainerStatusesOfDevice()
	}
	public onCoreConnected() {
		this.triggerReportUpdatedStatuses()
	}

	private updateExpectationStatus(
		expectationId: ExpectationId,
		workStatus: ExpectedPackageStatusAPI.WorkStatus | null
	) {
		this.toReportExpectationStatuses.set(expectationId, {
			status: workStatus,
			ids: undefined,
			hash: this.getIncrement(),
		})
		this.triggerReportUpdatedStatuses()
	}
	private updatePackageContainerPackageStatus(
		containerId: PackageContainerId,
		packageId: ExpectedPackageId,
		packageStatus: ExpectedPackageStatusAPI.PackageContainerPackageStatus | null
	): void {
		const key = packageOnPackageId(containerId, packageId)
		this.toReportPackageStatus.set(key, {
			status: packageStatus,
			ids: {
				containerId,
				packageId,
			},
			hash: this.getIncrement(),
		})
		this.triggerReportUpdatedStatuses()
	}
	private updatePackageContainerStatus(
		containerId: PackageContainerId,
		containerStatus: ExpectedPackageStatusAPI.PackageContainerStatus | null
	) {
		this.toReportPackageContainerStatus.set(containerId, {
			status: containerStatus,
			ids: undefined,
			hash: this.getIncrement(),
		})
		this.triggerReportUpdatedStatuses()
	}
	private triggerReportUpdatedStatuses() {
		const WAIT_TIME = 300

		if (this.sendUpdatedStatusesIsRunning) {
			// If it is already running, make it run again later:
			this.sendUpdatedStatusesRunAgain = true
		} else if (!this.triggerSendUpdatedStatusesTimeout) {
			this.triggerSendUpdatedStatusesTimeout = setTimeout(() => {
				delete this.triggerSendUpdatedStatusesTimeout
				this.sendUpdatedStatusesIsRunning = true

				Promise.resolve()
					.then(async () => {
						// Don't send any statuses if not connected:
						if (!this.packageManager.coreHandler.coreConnected) return

						this.logger.debug('triggerReportUpdatedStatuses: sending statuses')

						await this.reportUpdateExpectationStatus()
						await this.reportUpdatePackageContainerPackageStatus()
						await this.reportUpdatePackageContainerStatus()

						await this.checkAndReportPackageManagerStatus()
					})
					.catch((err) => {
						this.logger.error(`Error in triggerReportUpdatedStatuses: ${stringifyError(err)}`)
					})
					.finally(() => {
						this.sendUpdatedStatusesIsRunning = false
						if (this.sendUpdatedStatusesRunAgain) {
							this.sendUpdatedStatusesRunAgain = false
							this.triggerReportUpdatedStatuses()
						}
					})
			}, WAIT_TIME)
		}
	}
	private async reportUpdateExpectationStatus(): Promise<void> {
		await this.reportStatus(
			this.toReportExpectationStatuses,
			this.reportedExpectationStatuses,
			async (changesToSend) => {
				// Send the changes to Core:

				const sendToCore: UpdateExpectedPackageWorkStatusesChanges[] = []

				for (const change of changesToSend) {
					const expectationId = change.key

					if (change.type === 'delete') {
						sendToCore.push({
							type: 'delete',
							id: convProtectedString<ExpectationId, ExpectedPackageWorkStatusId>(expectationId),
						})
					} else if (change.type === 'insert') {
						sendToCore.push({
							type: 'insert',
							id: convProtectedString<ExpectationId, ExpectedPackageWorkStatusId>(expectationId),
							status: change.status,
						})
					} else {
						// Updated

						const reported = this.reportedExpectationStatuses.get(expectationId)
						if (!reported)
							throw new Error(
								`Internal Error: Expectation ${expectationId} not found in reportedExpectationStatuses (it should be)`
							)

						const mod: Partial<ExpectedPackageStatusAPI.WorkStatus> = {}
						for (const key of Object.keys(change.status) as (keyof ExpectedPackageStatusAPI.WorkStatus)[]) {
							if (change.status[key] !== reported.status[key]) {
								mod[key] = change.status[key] as any
							}
						}
						if (!_.isEmpty(mod)) {
							sendToCore.push({
								type: 'update',
								id: convProtectedString<ExpectationId, ExpectedPackageWorkStatusId>(expectationId),
								status: mod,
							})
						} else {
							// send nothing
						}
					}
				}

				try {
					await this.packageManager.coreHandler.coreMethods.updateExpectedPackageWorkStatuses(sendToCore)
				} catch (err) {
					// Ignore some errors:
					if (`${err}`.match(/ExpectedPackages ".*" not found/)) {
						// ignore these, we probably just have an old status on our side
						this.logger.warn(`reportUpdateExpectationStatus: Ignored error: ${stringifyError(err)}`)
					} else {
						throw err
					}
				}
			}
		)
	}
	private async reportUpdatePackageContainerPackageStatus(): Promise<void> {
		await this.reportStatus(this.toReportPackageStatus, this.reportedPackageStatuses, async (changesToSend) => {
			// Send the changes to Core:
			await this.packageManager.coreHandler.coreMethods.updatePackageContainerPackageStatuses(
				changesToSend.map((change) => {
					if (change.type === 'delete') {
						return {
							type: 'delete',
							containerId: unprotectString(change.ids.containerId),
							packageId: unprotectString(change.ids.packageId),
						}
					} else {
						// Inserted / Updated
						return {
							type: 'update',
							containerId: unprotectString(change.ids.containerId),
							packageId: unprotectString(change.ids.packageId),
							status: change.status,
						}
					}
				})
			)
		})
	}
	private async reportUpdatePackageContainerStatus(): Promise<void> {
		await this.reportStatus(
			this.toReportPackageContainerStatus,
			this.reportedPackageContainerStatuses,
			async (changesToSend) => {
				// Send the changes to Core:
				await this.packageManager.coreHandler.coreMethods.updatePackageContainerStatuses(
					changesToSend.map((change) => {
						if (change.type === 'delete') {
							return {
								type: 'delete',
								containerId: unprotectString(change.key),
							}
						} else {
							// Inserted / Updated
							return {
								type: 'update',
								containerId: unprotectString(change.key),
								status: change.status,
							}
						}
					})
				)
			}
		)
	}

	private async reportStatus<ID extends AnyProtectedString, Status extends { [key: string]: any } | null, Ids>(
		toReportStatus: ReportStatuses<ID, Status | null, Ids>,
		reportedStatuses: ReportStatuses<ID, Status, Ids>,
		sendChanges: (changesToSend: ChangesTosend<ID, Status, Ids>) => Promise<void>
	): Promise<void> {
		const changesTosend: ChangesTosend<ID, Status, Ids> = []

		for (const [key, o] of toReportStatus.entries()) {
			if (o.hash !== null) {
				if (!o.status) {
					// Removed
					if (reportedStatuses.has(key)) {
						changesTosend.push({
							type: 'delete',
							key,
							ids: o.ids,
							hash: o.hash,
						})
					}
				} else {
					// Inserted / Updated
					changesTosend.push({
						type: reportedStatuses.has(key) ? 'update' : 'insert',
						key,
						ids: o.ids,
						status: o.status,
						hash: o.hash,
					})
				}
			}
		}

		if (changesTosend.length) {
			try {
				// Send the batch of changes to Core:
				await sendChanges(changesTosend)

				// If the update was successful, update the reported statuses:

				for (const change of changesTosend) {
					// Store the status we just sent into reportedStatuses:
					if (change.type === 'delete') {
						reportedStatuses.delete(change.key)
					} else {
						reportedStatuses.set(change.key, {
							hash: change.hash,
							ids: change.ids,
							status: change.status,
						})
					}

					// Now, check if the toReportStatus hash is still the same:
					const orgToReportStaus = toReportStatus.get(change.key) as ReportStatus<Status, Ids> | undefined
					if (orgToReportStaus && orgToReportStaus.hash === change.hash) {
						// Ok, this means that we have sent the latest update to Core.

						if (orgToReportStaus.status === null) {
							// The original data was deleted, so we can delete it, to prevent mamory leaks:
							toReportStatus.delete(change.key)
							reportedStatuses.delete(change.key)
						} else {
							// Set the hash to null
							orgToReportStaus.hash = null
						}
					}
				}
			} catch (err) {
				// Provide some context to the error:
				this.logger.error(`Error in reportStatus : ${stringifyError(err)}`)
				throw err
			}
		}
	}
	private async checkAndReportPackageManagerStatus() {
		// If PM is not initialized properly (connected to workforce, workers etc)
		// If PM has an issue with a PackageContainer (like "can't access a folder"
		// If the work-queue is long (>10 items) and nothing has progressed for the past 10 minutes.

		const statuses: Statuses = {}

		for (const [containerId, container] of [
			...Array.from(this.reportedPackageContainerStatuses.entries()),
			...Array.from(this.toReportPackageContainerStatus.entries()),
		]) {
			statuses[`container-${containerId}`] = container.status
				? {
						statusCode: container.status?.status,
						message: container.status?.statusReason.user,
				  }
				: null
		}

		for (const [id, status] of Object.entries<Status | null>(this.expectationManagerStatuses)) {
			statuses[`expectationManager-${id}`] = status
		}
		this.packageManager.coreHandler
			.setStatus(statuses)
			.catch((e) => this.logger.error(`Error in updateCoreStatus : ${stringifyError(e)}`))
	}

	private onReportMonitoredPackages(
		containerId: PackageContainerId,
		monitorId: MonitorId,
		expectedPackages: ExpectedPackage.Any[]
	) {
		const expectedPackagesWraps: ExpectedPackageWrap[] = []

		for (const expectedPackage of expectedPackages) {
			const wrap = wrapExpectedPackage(this.packageManager.packageContainersCache, expectedPackage)
			if (wrap) {
				expectedPackagesWraps.push(wrap)
			}
		}

		this.logger.debug(
			`reportMonitoredPackages: ${expectedPackages.length} packages, ${expectedPackagesWraps.length} wraps`
		)

		let monitors = this.packageManager.monitoredPackages.get(containerId)
		if (!monitors) {
			monitors = new Map()
			this.packageManager.monitoredPackages.set(containerId, monitors)
		}
		monitors.set(monitorId, expectedPackagesWraps)

		this.packageManager.triggerUpdatedExpectedPackages()
	}
	private getIncrement(): number {
		if (this.increment >= Number.MAX_SAFE_INTEGER) this.increment = 0
		return this.increment++
	}
	private getCoreMethods() {
		return this.packageManager.coreHandler.notUsingCore
			? this.packageManager.coreHandler.fakeCore.coreMethods
			: this.packageManager.coreHandler.coreMethods
	}
}
export function wrapExpectedPackage(
	packageContainers: PackageContainers,
	expectedPackage: ExpectedPackage.Any
): ExpectedPackageWrap | undefined {
	const combinedSources: PackageContainerOnPackage[] = []

	for (const packageSource of expectedPackage.sources) {
		const lookedUpSource = packageContainers[packageSource.containerId] as PackageContainer | undefined
		if (lookedUpSource) {
			// We're going to combine the accessor attributes set on the Package with the ones defined on the source:
			const combinedSource: PackageContainerOnPackage = {
				...omit(clone(lookedUpSource), 'accessors'),
				accessors: {},
				containerId: packageSource.containerId,
			}

			const accessorIds: AccessorId[] = _.uniq(
				objectKeys(lookedUpSource.accessors).concat(objectKeys(packageSource.accessors || {}))
			)

			for (const accessorId of accessorIds) {
				const sourceAccessor = lookedUpSource.accessors[accessorId] as Accessor.Any | undefined

				const packageAccessor = packageSource.accessors[accessorId] as AccessorOnPackage.Any | undefined

				if (packageAccessor && sourceAccessor && packageAccessor.type === sourceAccessor.type) {
					combinedSource.accessors[accessorId] = deepExtend({}, sourceAccessor, packageAccessor)
				} else if (packageAccessor) {
					combinedSource.accessors[accessorId] = clone<AccessorOnPackage.Any>(packageAccessor)
				} else if (sourceAccessor) {
					combinedSource.accessors[accessorId] = clone<Accessor.Any>(sourceAccessor) as AccessorOnPackage.Any
				}
			}
			combinedSources.push(combinedSource)
		}
	}
	// Lookup Package targets:
	const combinedTargets: PackageContainerOnPackage[] = []

	for (const layer of expectedPackage.layers) {
		// Hack: we use the layer name as a 1-to-1 relation to a target containerId
		const packageContainerId = protectString<PackageContainerId>(layer) // hack

		if (packageContainerId) {
			const lookedUpTarget = packageContainers[packageContainerId] as PackageContainer | undefined
			if (lookedUpTarget) {
				combinedTargets.push({
					...omit(clone(lookedUpTarget), 'accessors'),
					accessors: lookedUpTarget.accessors,
					containerId: packageContainerId,
				})
			}
		}
	}

	if (combinedSources.length) {
		if (combinedTargets.length) {
			return {
				expectedPackage: expectedPackage as any,
				priority: 999, // Default: lowest priority
				sources: combinedSources,
				targets: combinedTargets,
				playoutDeviceId: null,
				external: true,
			}
		}
	}
	return undefined
}
/**
 * Recursively delete all undefined properties from the supplied object.
 * This is necessary as _.isEqual({ a: 1 }, { a: 1, b: undefined }) === false
 */
export function deleteAllUndefinedProperties<T extends { [key: string]: any }>(obj: T, deep = false): void {
	if (Array.isArray(obj)) {
		for (const v of obj) {
			deleteAllUndefinedProperties(v, deep)
		}
	} else if (obj && typeof obj === 'object') {
		const keys = Object.keys(obj)
		for (const key of keys) {
			if (obj[key] === undefined) {
				delete obj[key]
			} else {
				if (deep) {
					deleteAllUndefinedProperties(obj[key], deep)
				}
			}
		}
	}
}
export type ConvertExpectedPackage<E extends ExpectedPackageOrg.Base> = Omit<E, '_id' | 'sources' | 'sideEffect'> & {
	_id: ExpectedPackageId
	sources: Array<
		Omit<E['sources'][0], 'containerId' | 'accessors'> & {
			containerId: PackageContainerId // Converts string -> PackageContainerId
			accessors: {
				[accessorId: AccessorId]: AccessorOnPackage.Any
			}
		}
	>

	sideEffect: Omit<E['sideEffect'], 'previewContainerId' | 'thumbnailContainerId'> & {
		previewContainerId?: PackageContainerId | null
		thumbnailContainerId?: PackageContainerId | null
	}
}

export interface ExpectedPackageWrap {
	expectedPackage: ConvertExpectedPackage<PackageManagerExpectedPackageBase>
	/** Lower should be done first */
	priority: number
	sources: PackageContainerOnPackage[]
	targets: PackageContainerOnPackage[]
	playoutDeviceId: PeripheralDeviceId | null
	/** If set to true, this doesn't come from Core */
	external?: boolean
	// playoutLocation: any // todo?
}

export type PackageContainers = Record<PackageContainerId, PackageContainer>

type ReportStatuses<ID extends AnyProtectedString, Status, Ids> = Map<ID, ReportStatus<Status, Ids>>

type ReportStatus<Status, Ids> = {
	status: Status
	ids: Ids
	/** A unique value updated whenever the status is updated, or set to null if the status has already been reported. */
	hash: number | null
}
type ChangesTosend<ID extends AnyProtectedString, Status, Ids> = (
	| {
			type: 'update' | 'insert'
			key: ID
			ids: Ids
			status: Status
			hash: number
	  }
	| {
			type: 'delete'
			key: ID
			ids: Ids
			hash: number
	  }
)[]

type PackageOnPackageId = ProtectedString<'PackageOnPackageId', string>
function packageOnPackageId(containerId: PackageContainerId, packageId: ExpectedPackageId): PackageOnPackageId {
	return protectString<PackageOnPackageId>(`${containerId}_${packageId}`)
}
