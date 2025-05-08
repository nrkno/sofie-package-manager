// import * as HTTPServer from '@http-server/generic'
// import * as PackageManager from '@package-manager/generic'
import * as Workforce from '@sofie-package-manager/workforce'
import * as Worker from '@sofie-package-manager/worker'
import {
	Expectation,
	ExpectationManagerWorkerAgent,
	LogLevel,
	ProcessConfig,
	Reason,
	setupLogger,
	SingleAppConfig,
	initializeLogger,
	AppContainerWorkerAgent,
	Hook,
	DataStore,
	LoggerInstance,
	Statuses,
	ExpectationId,
	PackageContainerId,
	ExpectedPackageId,
	protectString,
	WorkerAgentId,
	DataId,
	LockId,
	objectKeys,
	ExpectationManagerId,
	AppContainerId,
	literal,
	WorkerConfig,
} from '@sofie-package-manager/api'
import {
	ExpectationManager,
	ExpectationManagerCallbacks,
	ExpectationManagerOptions,
} from '@sofie-package-manager/expectation-manager'
import { CoreMockAPI } from './coreMockAPI'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'

export const defaultTestConfig: SingleAppConfig = {
	singleApp: {
		workerCount: 1,
		workforcePort: 0,
		noHTTPServers: false,
	},
	process: {
		logPath: '',
		unsafeSSL: false,
		certificates: [],
		logLevel: LogLevel.INFO,
	},
	workforce: {
		port: null,
	},
	httpServer: {
		port: 0,
		basePath: '',
		apiKeyRead: '',
		apiKeyWrite: '',
		cleanFileAge: -1,
	},
	packageManager: {
		coreHost: '',
		corePort: 0,
		deviceId: '',
		deviceToken: '',
		disableWatchdog: true,
		port: null,
		accessUrl: null,
		workforceURL: null,
		watchFiles: false,
		noCore: false,
		chaosMonkey: false,
	},
	worker: {
		workerId: protectString<WorkerAgentId>('worker'),
		workforceURL: null,
		appContainerURL: 'internal', // This needs to be "internal", because `null` means run standalone
		resourceId: '',
		networkIds: [],
		windowsDriveLetters: ['X', 'Y', 'Z'],
		sourcePackageStabilityThreshold: 0, // Disabling this to speed up the tests
		costMultiplier: 1,
		considerCPULoad: null,
		pickUpCriticalExpectationsOnly: false,
		failurePeriod: 0,
		failurePeriodLimit: 0,
	},
	quantelHTTPTransformerProxy: {
		port: 0,
		transformerURL: '',
	},
	appContainer: {
		appContainerId: protectString<AppContainerId>('appContainer0'),
		workforceURL: null,
		port: 0,
		maxRunningApps: 1,
		minRunningApps: 1,
		spinDownTime: 0,
		maxAppKeepalive: 6 * 3600 * 1000, // 6 hrs, the default
		minCriticalWorkerApps: 0,
		worker: {
			resourceId: '',
			networkIds: [],
			windowsDriveLetters: ['X', 'Y', 'Z'],
			costMultiplier: 1,
			considerCPULoad: null,
			failurePeriod: 0,
			failurePeriodLimit: 0,
		},
	},
}

export async function setupExpectationManager(
	config: { process: ProcessConfig },
	debugLogging: boolean,
	workerCount: number = 1,
	callbacks: ExpectationManagerCallbacks,
	options: ExpectationManagerOptions,
	logFilterFunction: (level: string, ...args: any[]) => boolean
) {
	const logLevel = debugLogging ? LogLevel.DEBUG : LogLevel.WARN
	const logger = setupLogger(config, '', undefined, undefined, logLevel, logFilterFunction)

	const expectationManager = new ExpectationManager(
		logger,
		protectString<ExpectationManagerId>('manager0'),
		{ type: 'internal' },
		undefined,
		{ type: 'internal' },
		callbacks,
		options
	)
	// expectationManager.on('error', console.error)

	// Initializing HTTP proxy Server:
	// const httpServer = new HTTPServer.PackageProxyServer(logger, config)
	// await httpServer.init()

	// Initializing Workforce:
	const workforce = new Workforce.Workforce(logger, defaultTestConfig)
	await workforce.init()

	const mockAppContainer = new MockAppContainer(logger)

	// Initializing Expectation Manager:
	expectationManager.hookToWorkforce(workforce.getExpectationManagerHook())
	await expectationManager.init()

	// Initialize workers:
	const workerAgents: Worker.WorkerAgent[] = []
	let workerI = 0
	const addWorker = async (workerConfig: Partial<WorkerConfig['worker']> = {}) => {
		const workerId = protectString<WorkerAgentId>(defaultTestConfig.worker.workerId + '_' + workerI++)
		const workerAgent = new Worker.WorkerAgent(logger, {
			...defaultTestConfig,
			worker: {
				...defaultTestConfig.worker,
				...workerConfig,
				workerId: workerId,
			},
		})
		workerAgents.push(workerAgent)

		workerAgent.hookToAppContainer(mockAppContainer.getWorkerAgentHook())
		workerAgent.hookToWorkforce(workforce.getWorkerAgentHook())
		workerAgent.hookToExpectationManager(expectationManager.managerId, expectationManager.getWorkerAgentHook())
		await workerAgent.init()

		return workerId
	}
	const removeWorker = async (workerId: WorkerAgentId) => {
		const index = workerAgents.findIndex((wa) => wa.id === workerId)
		if (index !== -1) {
			const workerAgent = workerAgents[index]

			expectationManager.removeWorkerAgentHook(workerAgent.id)

			workerAgent.terminate()
			// Remove from array:
			workerAgents.splice(index, 1)
		}
	}

	for (let i = 0; i < workerCount; i++) {
		console.log('Adding worker', i)
		await addWorker()
	}

	return {
		workforce,
		workerAgents,
		expectationManager,
		addWorker,
		removeWorker,
	}
}

export async function prepareTestEnvironment(debugLogging: boolean): Promise<TestEnvironment> {
	const managerStatuses: Statuses = {}
	const expectationStatuses: ExpectationStatuses = {}
	const containerStatuses: ContainerStatuses = {}
	const coreApi = new CoreMockAPI()

	const WAIT_JOB_TIME = 500 // ms
	const WAIT_SCAN_TIME = 1000 // ms
	const WORK_TIMEOUT_TIME = 900 // ms
	const ERROR_WAIT_TIME = 500

	const ALLOW_SKIPPING_QUEUE_TIME = 3000 // ms
	const PARALLEL_CONCURRENCY = 10

	const SCALE_UP_TIME = 100

	const config: { process: ProcessConfig } = {
		process: {
			certificates: [],
			logPath: undefined,
			unsafeSSL: false,
			logLevel: debugLogging ? LogLevel.DEBUG : LogLevel.INFO,
		},
	}
	initializeLogger(config)

	let logFilterFunctionInner: (level: string, ...args: any[]) => boolean = () => {
		return true // Default behavior: no filtering
	}
	let logFilterFunction = (level: string, ...args: any[]) => logFilterFunctionInner(level, ...args)
	const setLogFilterFunction = (filter: (level: string, ...args: any[]) => boolean) => {
		logFilterFunctionInner = filter
	}

	const em = await setupExpectationManager(
		config,
		debugLogging,
		1,
		{
			reportManagerStatus: (statuses: Statuses) => {
				if (debugLogging) console.log('reportManagerStatus', statuses)

				for (const [key, status] of Object.entries(statuses)) {
					managerStatuses[key] = status
				}
			},
			reportExpectationStatus: (
				expectationId: ExpectationId,
				_expectation: Expectation.Any | null,
				actualVersionHash: string | null,
				statusInfo: {
					status?: string
					progress?: number
					statusReason?: Reason
				}
			) => {
				if (debugLogging) console.log('reportExpectationStatus', expectationId, actualVersionHash, statusInfo)

				let o = expectationStatuses[expectationId]
				if (!o) {
					o = {
						actualVersionHash: null,
						statusInfo: {},
					}
					expectationStatuses[expectationId] = o
				}

				if (actualVersionHash) o.actualVersionHash = actualVersionHash
				if (statusInfo.status) o.statusInfo.status = statusInfo.status
				if (statusInfo.progress) o.statusInfo.progress = statusInfo.progress
				if (statusInfo.statusReason) o.statusInfo.statusReason = statusInfo.statusReason
			},
			reportPackageContainerPackageStatus: (
				containerId: PackageContainerId,
				packageId: ExpectedPackageId,
				packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
			) => {
				if (debugLogging) console.log('reportPackageContainerPackageStatus', containerId, packageId, packageStatus)

				let container = containerStatuses[containerId]
				if (!container) {
					container = {
						packages: {},
					}
					containerStatuses[containerId] = container
				}

				container.packages[packageId] = {
					packageStatus: packageStatus,
				}
			},
			reportPackageContainerExpectationStatus: () => {
				// todo
			},
			messageFromWorker: async (message: ExpectationManagerWorkerAgent.MessageFromWorkerPayload.Any) => {
				switch (message.type) {
					case 'fetchPackageInfoMetadata':
						return coreApi.fetchPackageInfoMetadata(...message.arguments)
					case 'updatePackageInfo':
						return coreApi.updatePackageInfo(...message.arguments)
					case 'removePackageInfo':
						return coreApi.removePackageInfo(...message.arguments)
					case 'reportFromMonitorPackages':
						return coreApi.reportFromMonitorPackages(...message.arguments)
					default:
						// @ts-expect-error message.type is never
						throw new Error(`Unsupported message type "${message.type}"`)
				}
			},
		},
		literal<ExpectationManagerOptions>({
			constants: {
				EVALUATE_INTERVAL: WAIT_SCAN_TIME - WAIT_JOB_TIME - 300,
				FULFILLED_MONITOR_TIME: WAIT_SCAN_TIME - WAIT_JOB_TIME - 300,
				WORK_TIMEOUT_TIME: WORK_TIMEOUT_TIME - 300,
				ERROR_WAIT_TIME: ERROR_WAIT_TIME - 300,
				ALLOW_SKIPPING_QUEUE_TIME,
				PARALLEL_CONCURRENCY,

				SCALE_UP_TIME: SCALE_UP_TIME,
			},
		}),
		logFilterFunction
	)

	return {
		WAIT_JOB_TIME,
		WAIT_JOB_TIME_SAFE: WAIT_JOB_TIME + 1000,
		WAIT_SCAN_TIME,
		WORK_TIMEOUT_TIME,
		ERROR_WAIT_TIME,
		ALLOW_SKIPPING_QUEUE_TIME,
		PARALLEL_CONCURRENCY,
		SCALE_UP_TIME,
		expectationManager: em.expectationManager,
		workerAgents: em.workerAgents,
		workforce: em.workforce,
		coreApi,
		expectationStatuses,
		containerStatuses,
		reset: () => {
			if (debugLogging) {
				console.log('RESET ENVIRONMENT')
			}
			setLogFilterFunction(() => true)
			em.expectationManager.resetWork()
			objectKeys(expectationStatuses).forEach((key: ExpectationId) => {
				delete expectationStatuses[key]
			})
			objectKeys(containerStatuses).forEach((key: PackageContainerId) => {
				delete containerStatuses[key]
			})

			coreApi.reset()
		},
		terminate: () => {
			em.expectationManager.terminate()
			em.workforce.terminate()
			em.workerAgents.forEach((workerAgent) => workerAgent.terminate())
		},
		addWorker: em.addWorker,
		removeWorker: em.removeWorker,
		setLogFilterFunction: setLogFilterFunction,
	}
}
export interface TestEnvironment {
	WAIT_JOB_TIME: number
	/** A little longer than WAIT_JOB_TIME, to be used in waitUntil()-expressions */
	WAIT_JOB_TIME_SAFE: number
	WAIT_SCAN_TIME: number
	WORK_TIMEOUT_TIME: number
	ERROR_WAIT_TIME: number
	ALLOW_SKIPPING_QUEUE_TIME: number
	PARALLEL_CONCURRENCY: number
	SCALE_UP_TIME: number
	expectationManager: ExpectationManager
	workerAgents: Worker.WorkerAgent[]
	workforce: Workforce.Workforce
	coreApi: CoreMockAPI
	expectationStatuses: ExpectationStatuses
	containerStatuses: ContainerStatuses
	reset: () => void
	terminate: () => void
	addWorker: (workerConfig?: Partial<WorkerConfig['worker']>) => Promise<WorkerAgentId>
	removeWorker: (id: WorkerAgentId) => Promise<void>
	setLogFilterFunction: (filter: (level: string, ...args: any[]) => boolean) => void
}

export type ExpectationStatuses = Record<
	ExpectationId,
	{
		actualVersionHash: string | null
		statusInfo: {
			status?: string
			progress?: number
			statusReason?: Reason
		}
	}
>
export type ContainerStatuses = Record<
	PackageContainerId,
	{
		packages: Record<
			ExpectedPackageId,
			{
				packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
			}
		>
	}
>

/** This is a mock of the AppContainer, used in unit tests */
class MockAppContainer {
	private logger: LoggerInstance
	private workerStorage: DataStore
	constructor(logger: LoggerInstance) {
		this.logger = logger.category('AppContainer')

		const WORKER_DATA_LOCK_TIMEOUT = 1000
		this.workerStorage = new DataStore(this.logger, WORKER_DATA_LOCK_TIMEOUT)
	}

	getWorkerAgentHook(): Hook<AppContainerWorkerAgent.AppContainer, AppContainerWorkerAgent.WorkerAgent> {
		return (clientId: WorkerAgentId, _clientMethods: Omit<AppContainerWorkerAgent.WorkerAgent, 'id'>) => {
			// On connection from a workerAgent

			const workerAgentMethods: AppContainerWorkerAgent.AppContainer = {
				id: clientId,
				ping: async () => {
					// do nothing
				},
				requestSpinDown: async () => {
					// do nothing
				},

				workerStorageWriteLock: async (
					dataId: DataId,
					customTimeout?: number
				): Promise<{ lockId: LockId; current: any | undefined }> => {
					return this.workerStorage.getWriteLock(dataId, customTimeout)
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

			return workerAgentMethods
		}
	}
}
