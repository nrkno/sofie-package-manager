// import * as HTTPServer from '@http-server/generic'
// import * as PackageManager from '@package-manager/generic'
import * as Workforce from '@shared/workforce'
import * as Worker from '@shared/worker'
import * as Winston from 'winston'
import { Expectation, ExpectationManagerWorkerAgent, LoggerInstance, Reason, SingleAppConfig } from '@shared/api'
// import deepExtend from 'deep-extend'
import { ExpectationManager, ExpectationManagerCallbacks, ExpectationManagerOptions } from '@shared/expectation-manager'
import { CoreMockAPI } from './coreMockAPI'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'

const defaultTestConfig: SingleAppConfig = {
	singleApp: {
		workerCount: 1,
	},
	process: {
		logPath: '',
		unsafeSSL: false,
		certificates: [],
	},
	workforce: {
		port: null,
	},
	httpServer: {
		port: 0,
		basePath: '',
		apiKeyRead: '',
		apiKeyWrite: '',
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
	},
	worker: {
		workerId: 'worker',
		workforceURL: null,
		appContainerURL: null,
		resourceId: '',
		networkIds: [],
		windowsDriveLetters: ['X', 'Y', 'Z'],
		sourcePackageStabilityThreshold: 0, // Disabling this to speed up the tests
	},
	quantelHTTPTransformerProxy: {
		port: 0,
		transformerURL: '',
	},
	appContainer: {
		appContainerId: 'appContainer0',
		workforceURL: null,
		port: 0,
		maxRunningApps: 1,
		resourceId: '',
		networkIds: [],
		windowsDriveLetters: ['X', 'Y', 'Z'],
	},
}

export async function setupExpectationManager(
	debugLogging: boolean,
	workerCount: number = 1,
	callbacks: ExpectationManagerCallbacks,
	options?: ExpectationManagerOptions
) {
	const logger = new Winston.Logger({}) as LoggerInstance
	logger.add(Winston.transports.Console, {
		level: debugLogging ? 'debug' : 'warn',
	})

	const expectationManager = new ExpectationManager(
		logger,
		'manager0',
		{ type: 'internal' },
		undefined,
		{ type: 'internal' },
		callbacks,
		options
	)

	// Initializing HTTP proxy Server:
	// const httpServer = new HTTPServer.PackageProxyServer(logger, config)
	// await httpServer.init()

	// Initializing Workforce:
	const workforce = new Workforce.Workforce(logger, defaultTestConfig)
	await workforce.init()

	// Initializing Expectation Manager:
	expectationManager.hookToWorkforce(workforce.getExpectationManagerHook())
	await expectationManager.init()

	// Initialize workers:
	const workerAgents: Worker.WorkerAgent[] = []
	for (let i = 0; i < workerCount; i++) {
		const workerAgent = new Worker.WorkerAgent(logger, {
			...defaultTestConfig,
			worker: {
				...defaultTestConfig.worker,
				workerId: defaultTestConfig.worker.workerId + '_' + i,
			},
		})
		workerAgents.push(workerAgent)

		workerAgent.hookToWorkforce(workforce.getWorkerAgentHook())
		workerAgent.hookToExpectationManager(expectationManager.managerId, expectationManager.getWorkerAgentHook())
		await workerAgent.init()
	}

	return {
		workforce,
		workerAgents,
		expectationManager,
	}
}

export async function prepareTestEnviromnent(debugLogging: boolean): Promise<TestEnviromnent> {
	const expectationStatuses: ExpectationStatuses = {}
	const containerStatuses: ContainerStatuses = {}
	const coreApi = new CoreMockAPI()

	const WAIT_JOB_TIME = 500 // ms
	const WAIT_SCAN_TIME = 1000 // ms

	const em = await setupExpectationManager(
		debugLogging,
		1,
		{
			reportExpectationStatus: (
				expectationId: string,
				_expectaction: Expectation.Any | null,
				actualVersionHash: string | null,
				statusInfo: {
					status?: string
					progress?: number
					statusReason?: Reason
				}
			) => {
				if (debugLogging) console.log('reportExpectationStatus', expectationId, actualVersionHash, statusInfo)

				if (!expectationStatuses[expectationId]) {
					expectationStatuses[expectationId] = {
						actualVersionHash: null,
						statusInfo: {},
					}
				}
				const o = expectationStatuses[expectationId]
				if (actualVersionHash) o.actualVersionHash = actualVersionHash
				if (statusInfo.status) o.statusInfo.status = statusInfo.status
				if (statusInfo.progress) o.statusInfo.progress = statusInfo.progress
				if (statusInfo.statusReason) o.statusInfo.statusReason = statusInfo.statusReason
			},
			reportPackageContainerPackageStatus: (
				containerId: string,
				packageId: string,
				packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
			) => {
				if (debugLogging)
					console.log('reportPackageContainerPackageStatus', containerId, packageId, packageStatus)
				if (!containerStatuses[containerId]) {
					containerStatuses[containerId] = {
						packages: {},
					}
				}
				const container = containerStatuses[containerId]
				container.packages[packageId] = {
					packageStatus: packageStatus,
				}
			},
			reportPackageContainerExpectationStatus: () => {
				// todo
				// if (debugLogging) console.log('reportPackageContainerExpectationStatus', containerId, packageId, packageStatus)
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
		{
			constants: {
				EVALUATE_INTERVAL: WAIT_SCAN_TIME - WAIT_JOB_TIME - 300,
				FULLFILLED_MONITOR_TIME: WAIT_SCAN_TIME - WAIT_JOB_TIME - 300,
			},
		}
	)

	return {
		WAIT_JOB_TIME,
		WAIT_SCAN_TIME,
		expectationManager: em.expectationManager,
		coreApi,
		expectationStatuses,
		containerStatuses,
		reset: () => {
			if (debugLogging) {
				console.log('RESET ENVIRONMENT')
			}
			em.expectationManager.resetWork()
			Object.keys(expectationStatuses).forEach((id) => delete expectationStatuses[id])
			Object.keys(containerStatuses).forEach((id) => delete containerStatuses[id])
			coreApi.reset()
		},
		terminate: () => {
			em.expectationManager.terminate()
			em.workforce.terminate()
			em.workerAgents.forEach((workerAgent) => workerAgent.terminate())
		},
	}
}
export interface TestEnviromnent {
	WAIT_JOB_TIME: number
	WAIT_SCAN_TIME: number
	expectationManager: ExpectationManager
	coreApi: CoreMockAPI
	expectationStatuses: ExpectationStatuses
	containerStatuses: ContainerStatuses
	reset: () => void
	terminate: () => void
}

export interface ExpectationStatuses {
	[expectationId: string]: {
		actualVersionHash: string | null
		statusInfo: {
			status?: string
			progress?: number
			statusReason?: Reason
		}
	}
}
export interface ContainerStatuses {
	[containerId: string]: {
		packages: {
			[packageId: string]: {
				packageStatus: Omit<ExpectedPackageStatusAPI.PackageContainerPackageStatus, 'statusChanged'> | null
			}
		}
	}
}
