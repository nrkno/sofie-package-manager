import _ from 'underscore'
import { CoreHandler } from './coreHandler'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { protectString, protectStringArray } from '@sofie-automation/server-core-integration'
// eslint-disable-next-line node/no-extraneous-import
import { UpdateExpectedPackageWorkStatusesChanges } from '@sofie-automation/shared-lib/dist/peripheralDevice/methodsAPI'
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
} from '@sofie-package-manager/api'
import deepExtend from 'deep-extend'
import clone = require('fast-clone')
import { GenerateExpectationApi } from './generateExpectations/api'
import { PackageManagerSettings } from './generated/options'

import * as NRK from './generateExpectations/nrk'

export class PackageManagerHandler {
	public coreHandler!: CoreHandler
	private _observers: Array<any> = []

	public expectationManager: ExpectationManager

	private expectedPackageCache: { [id: string]: ExpectedPackageWrap } = {}
	public packageContainersCache: PackageContainers = {}

	private externalData: { packageContainers: PackageContainers; expectedPackages: ExpectedPackageWrap[] } = {
		packageContainers: {},
		expectedPackages: [],
	}
	private _triggerUpdatedExpectedPackagesTimeout: NodeJS.Timeout | null = null
	public monitoredPackages: {
		[monitorId: string]: ResultingExpectedPackage[]
	} = {}
	settings: PackageManagerSettings = {
		delayRemoval: 0,
		useTemporaryFilePath: false,
	}
	callbacksHandler: ExpectationManagerCallbacksHandler

	private dataSnapshot: {
		updated: number
		expectedPackages: ResultingExpectedPackage[]
		packageContainers: PackageContainers
		expectations: {
			[id: string]: Expectation.Any
		}
		packageContainerExpectations: { [id: string]: PackageContainerExpectation }
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
		private managerId: string,
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

		const expectedPackagesObserver = this.coreHandler.observe('deviceExpectedPackages')
		expectedPackagesObserver.added = () => {
			this.triggerUpdatedExpectedPackages()
		}
		expectedPackagesObserver.changed = () => {
			this.triggerUpdatedExpectedPackages()
		}
		expectedPackagesObserver.removed = () => {
			this.triggerUpdatedExpectedPackages()
		}
		this._observers.push(expectedPackagesObserver)
	}
	public triggerUpdatedExpectedPackages(): void {
		if (this._triggerUpdatedExpectedPackagesTimeout) {
			clearTimeout(this._triggerUpdatedExpectedPackagesTimeout)
			this._triggerUpdatedExpectedPackagesTimeout = null
		}

		this._triggerUpdatedExpectedPackagesTimeout = setTimeout(() => {
			this._triggerUpdatedExpectedPackagesTimeout = null

			const expectedPackages: ExpectedPackageWrap[] = []
			const packageContainers: PackageContainers = {}

			let activePlaylist: ActivePlaylist = {
				_id: '',
				active: false,
				rehearsal: false,
			}
			let activeRundowns: ActiveRundown[] = []

			// Add from external data:
			{
				for (const expectedPackage of this.externalData.expectedPackages) {
					expectedPackages.push(expectedPackage)
				}
				Object.assign(packageContainers, this.externalData.packageContainers)
			}

			if (!this.coreHandler.notUsingCore) {
				const objs = this.coreHandler.getCollection<any>('deviceExpectedPackages').find(() => true)

				const activePlaylistObj = objs.find((o) => o.type === 'active_playlist')
				if (!activePlaylistObj) {
					this.logger.warn(`Collection objects active_playlist not found`)
					this.logger.info(`objs in deviceExpectedPackages:`, objs)
					return
				}
				activePlaylist = activePlaylistObj.activeplaylist as ActivePlaylist
				activeRundowns = activePlaylistObj.activeRundowns as ActiveRundown[]

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
							// Note: There might be duplicates of packages here, to be deduplicated later
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
			}

			// Add from Monitors:
			{
				for (const monitorExpectedPackages of Object.values(this.monitoredPackages)) {
					for (const expectedPackage of monitorExpectedPackages) {
						expectedPackages.push(expectedPackage)
					}
				}
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
			// Note: There might be duplicates in expectedPackages

			const existing = this.expectedPackageCache[exp.expectedPackage._id]
			if (
				!existing ||
				existing.priority > exp.priority // If the existing priority is lower (ie higher), replace it
			) {
				this.expectedPackageCache[exp.expectedPackage._id] = exp
			}
		}

		this.logger.debug(`Has ${expectedPackages.length} expectedPackages`)
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
		this.logger.debug(`Has ${Object.keys(expectations).length} expectations`)
		// this.logger.debug(JSON.stringify(expectations, null, 2))
		this.dataSnapshot.expectations = expectations

		const packageContainerExpectations = this.expectationGeneratorApi.getPackageContainerExpectations(
			this.expectationManager.managerId,
			this.packageContainersCache,
			activePlaylist
		)
		this.logger.debug(`Has ${Object.keys(packageContainerExpectations).length} packageContainerExpectations`)
		this.dataSnapshot.packageContainerExpectations = packageContainerExpectations
		this.dataSnapshot.updated = Date.now()

		this.ensureMandatoryPackageContainerExpectations(packageContainerExpectations)

		// Step 2: Track and handle new expectations:
		this.expectationManager.updatePackageContainerExpectations(packageContainerExpectations)

		this.expectationManager.updateExpectations(expectations)
	}
	public restartExpectation(workId: string): void {
		// This method can be called from core
		this.expectationManager.restartExpectation(workId)
	}
	public restartAllExpectations(): void {
		// This method can be called from core
		this.expectationManager.restartAllExpectations()
	}
	public abortExpectation(workId: string): void {
		// This method can be called from core
		this.expectationManager.abortExpectation(workId)
	}
	public restartPackageContainer(containerId: string): void {
		// This method can be called from core
		this.expectationManager.restartPackageContainer(containerId)
	}
	public getDataSnapshot(): any {
		return {
			...this.dataSnapshot,

			reportedStatuses: {
				reportedExpectationStatuses: this.callbacksHandler.reportedExpectationStatuses,
				reportedPackageStatuses: this.callbacksHandler.reportedPackageStatuses,
				reportedPackageContainerStatuses: this.callbacksHandler.reportedPackageContainerStatuses,
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
				countPackageContainers: Object.keys(this.dataSnapshot.packageContainers).length,
				countExpectations: Object.keys(this.dataSnapshot.expectations).length,
				countPackageContainerExpectations: Object.keys(this.dataSnapshot.packageContainerExpectations).length,
			},
			updated: Date.now(),
		}
	}
	public async debugKillApp(appId: string): Promise<void> {
		return this.expectationManager.debugKillApp(appId)
	}

	/** Ensures that the packageContainerExpectations containes the mandatory expectations */
	private ensureMandatoryPackageContainerExpectations(packageContainerExpectations: {
		[id: string]: PackageContainerExpectation
	}): void {
		for (const [containerId, packageContainer] of Object.entries(this.packageContainersCache)) {
			/** Is the Container writeable */
			let isWriteable = false
			for (const accessor of Object.values(packageContainer.accessors)) {
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
				if (!packageContainerExpectations[containerId].cronjobs.cleanup) {
					// Add cronjob to clean up:
					packageContainerExpectations[containerId].cronjobs.cleanup = {
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

	private toReportExpectationStatuses: ReportStatuses<ExpectedPackageStatusAPI.WorkStatus | null, undefined> = {}
	public reportedExpectationStatuses: ReportStatuses<ExpectedPackageStatusAPI.WorkStatus, undefined> = {}

	private toReportPackageStatus: ReportStatuses<
		ExpectedPackageStatusAPI.PackageContainerPackageStatus | null,
		{ containerId: string; packageId: string }
	> = {}
	public reportedPackageStatuses: ReportStatuses<
		ExpectedPackageStatusAPI.PackageContainerPackageStatus,
		{ containerId: string; packageId: string }
	> = {}

	private toReportPackageContainerStatus: ReportStatuses<
		ExpectedPackageStatusAPI.PackageContainerStatus | null,
		undefined
	> = {}
	public reportedPackageContainerStatuses: ReportStatuses<
		ExpectedPackageStatusAPI.PackageContainerStatus,
		undefined
	> = {}
	private expectationManagerStatuses: Statuses = {}

	constructor(logger: LoggerInstance, private packageManager: PackageManagerHandler) {
		this.logger = logger.category('ExpectationManagerCallbacksHandler')
	}

	public reportExpectationStatus(
		expectationId: string,
		expectaction: Expectation.Any | null,
		actualVersionHash: string | null,
		statusInfo: {
			status?: ExpectedPackageStatusAPI.WorkStatusState
			progress?: number
			priority?: number
			statusReason?: Reason
			prevStatusReasons?: { [state: string]: Reason }
		}
	): void {
		if (!expectaction) {
			if (this.toReportExpectationStatuses[expectationId]) {
				this.updateExpectationStatus(expectationId, null)
			}
		} else {
			if (!expectaction.statusReport.sendReport) return // Don't report the status

			const previouslyReported = this.toReportExpectationStatuses[expectationId]?.status

			// Remove undefined properties, so they don't mess with the spread operators below:
			deleteAllUndefinedProperties(expectaction.statusReport)
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
				...expectaction.statusReport,
				...statusInfo,

				fromPackages: expectaction.fromPackages.map((fromPackage) => {
					const prevPromPackage = this.toReportExpectationStatuses[expectationId]?.status?.fromPackages.find(
						(p) => p.id === fromPackage.id
					)
					return {
						id: fromPackage.id,
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
		containerId: string,
		packageId: string,
		packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
	): void {
		const packageContainerPackageId = `${containerId}_${packageId}`
		if (!packageStatus) {
			this.updatePackageContainerPackageStatus(containerId, packageId, null)
		} else {
			const previouslyReported = this.toReportPackageStatus[packageContainerPackageId]?.status

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
		containerId: string,
		statusInfo: ExpectedPackageStatusAPI.PackageContainerStatus | null
	): void {
		if (!statusInfo) {
			this.updatePackageContainerStatus(containerId, null)
		} else {
			const previouslyReported = this.toReportPackageContainerStatus[containerId]?.status

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
				if (this.packageManager.coreHandler.notUsingCore) return // Abort if we are not using core
				return this.packageManager.coreHandler.coreMethods.fetchPackageInfoMetadata(
					message.arguments[0],
					protectStringArray(message.arguments[1])
				)
			}
			case 'updatePackageInfo': {
				if (this.packageManager.coreHandler.notUsingCore) return // Abort if we are not using core
				return this.packageManager.coreHandler.coreMethods.updatePackageInfo(
					message.arguments[0],
					protectString(message.arguments[1]),
					message.arguments[2],
					message.arguments[3],
					message.arguments[4]
				)
			}
			case 'removePackageInfo': {
				if (this.packageManager.coreHandler.notUsingCore) return // Abort if we are not using core
				return this.packageManager.coreHandler.coreMethods.removePackageInfo(
					message.arguments[0],
					protectString(message.arguments[1]),
					message.arguments[2]
				)
			}
			case 'reportFromMonitorPackages':
				this.reportMonitoredPackages(...message.arguments)
				break

			default:
				// @ts-expect-error message is never
				throw new Error(`Unsupported message type "${message.type}"`)
		}
	}
	public async cleanReportedStatuses() {
		// Clean out all reported statuses, this is an easy way to sync a clean state with core

		if (this.packageManager.coreHandler.notUsingCore) return // Abort if we are not using core

		this.reportedExpectationStatuses = {}
		await this.packageManager.coreHandler.coreMethods.removeAllExpectedPackageWorkStatusOfDevice()

		this.reportedPackageContainerStatuses = {}
		await this.packageManager.coreHandler.coreMethods.removeAllPackageContainerPackageStatusesOfDevice()

		this.reportedPackageStatuses = {}
		await this.packageManager.coreHandler.coreMethods.removeAllPackageContainerStatusesOfDevice()
	}
	public onCoreConnected() {
		this.triggerReportUpdatedStatuses()
	}

	private updateExpectationStatus(expectationId: string, workStatus: ExpectedPackageStatusAPI.WorkStatus | null) {
		this.toReportExpectationStatuses[expectationId] = {
			status: workStatus,
			ids: undefined,
			hash: this.getIncrement(),
		}
		this.triggerReportUpdatedStatuses()
	}
	private updatePackageContainerPackageStatus(
		containerId: string,
		packageId: string,
		packageStatus: ExpectedPackageStatusAPI.PackageContainerPackageStatus | null
	): void {
		const key = `${containerId}_${packageId}`
		this.toReportPackageStatus[key] = {
			status: packageStatus,
			ids: {
				containerId,
				packageId,
			},
			hash: this.getIncrement(),
		}
		this.triggerReportUpdatedStatuses()
	}
	private updatePackageContainerStatus(
		containerId: string,
		containerStatus: ExpectedPackageStatusAPI.PackageContainerStatus | null
	) {
		this.toReportPackageContainerStatus[containerId] = {
			status: containerStatus,
			ids: undefined,
			hash: this.getIncrement(),
		}
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
							id: protectString(expectationId),
						})
					} else if (change.type === 'insert') {
						sendToCore.push({
							type: 'insert',
							id: protectString(expectationId),
							status: change.status,
						})
					} else {
						// Updated

						const reported = this.reportedExpectationStatuses[expectationId]
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
								id: protectString(expectationId),
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
							containerId: change.ids.containerId,
							packageId: change.ids.packageId,
						}
					} else {
						// Inserted / Updated
						return {
							type: 'update',
							containerId: change.ids.containerId,
							packageId: change.ids.packageId,
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
								containerId: change.key,
							}
						} else {
							// Inserted / Updated
							return {
								type: 'update',
								containerId: change.key,
								status: change.status,
							}
						}
					})
				)
			}
		)
	}

	private async reportStatus<Status extends { [key: string]: any } | null, Ids>(
		toReportStatus: ReportStatuses<Status | null, Ids>,
		reportedStatuses: ReportStatuses<Status, Ids>,
		sendChanges: (changesToSend: ChangesTosend<Status, Ids>) => Promise<void>
	): Promise<void> {
		const changesTosend: ChangesTosend<Status, Ids> = []

		for (const [key, o] of Object.entries(toReportStatus)) {
			if (o.hash !== null) {
				if (!o.status) {
					// Removed
					if (reportedStatuses[key]) {
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
						type: reportedStatuses[key] ? 'update' : 'insert',
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
						delete reportedStatuses[change.key]
					} else {
						reportedStatuses[change.key] = {
							hash: change.hash,
							ids: change.ids,
							status: change.status,
						}
					}

					// Now, check if the toReportStatus hash is still the same:
					const orgToReportStaus = toReportStatus[change.key] as ReportStatus<Status, Ids> | undefined
					if (orgToReportStaus && orgToReportStaus.hash === change.hash) {
						// Ok, this means that we have sent the latest update to Core.

						if (orgToReportStaus.status === null) {
							// The original data was deleted, so we can delete it, to prevent mamory leaks:
							delete toReportStatus[change.key]
							delete reportedStatuses[change.key]
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
			...Object.entries(this.reportedPackageContainerStatuses),
			...Object.entries(this.toReportPackageContainerStatus),
		]) {
			statuses[`container-${containerId}`] = container.status
				? {
						statusCode: container.status?.status,
						message: container.status?.statusReason.user,
				  }
				: null
		}

		for (const [id, status] of Object.entries(this.expectationManagerStatuses)) {
			statuses[`expectationManager-${id}`] = status
		}
		this.packageManager.coreHandler
			.setStatus(statuses)
			.catch((e) => this.logger.error(`Error in updateCoreStatus : ${stringifyError(e)}`))
	}

	private reportMonitoredPackages(_containerId: string, monitorId: string, expectedPackages: ExpectedPackage.Any[]) {
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

		this.packageManager.monitoredPackages[monitorId] = expectedPackagesWraps

		this.packageManager.triggerUpdatedExpectedPackages()
	}
	private getIncrement(): number {
		if (this.increment >= Number.MAX_SAFE_INTEGER) this.increment = 0
		return this.increment++
	}
}
export function wrapExpectedPackage(
	packageContainers: PackageContainers,
	expectedPackage: ExpectedPackage.Any
): ExpectedPackageWrap | undefined {
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
				Object.keys(lookedUpSource.accessors).concat(Object.keys(packageSource.accessors || {}))
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
		const packageContainerId: string = layer

		if (packageContainerId) {
			const lookedUpTarget = packageContainers[packageContainerId]
			if (lookedUpTarget) {
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
			return {
				expectedPackage: expectedPackage,
				priority: 999, // Default: lowest priority
				sources: combinedSources,
				targets: combinedTargets,
				playoutDeviceId: '',
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

type ReportStatuses<Status, Ids> = {
	[key: string]: ReportStatus<Status, Ids>
}
type ReportStatus<Status, Ids> = {
	status: Status
	ids: Ids
	/** A unique value updated whenever the status is updated, or set to null if the status has already been reported. */
	hash: number | null
}
type ChangesTosend<Status, Ids> = (
	| {
			type: 'update' | 'insert'
			key: string
			ids: Ids
			status: Status
			hash: number
	  }
	| {
			type: 'delete'
			key: string
			ids: Ids
			hash: number
	  }
)[]
