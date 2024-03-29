import {
	AppContainerConfig,
	AppContainerProcessConfig,
	LogLevel,
	ProcessConfig,
	initializeLogger,
	literal,
	protectString,
	setupLogger,
	WebsocketServer,
	WorkerAgentId,
} from '@sofie-package-manager/api'
// @ts-ignore mock
import { mockOnNewProcess, mockListAllProcesses, mockClearAllProcesses } from 'child_process'
import { AppContainer } from '../../appContainer'
import deepExtend from 'deep-extend'
import { WorkerAgentAPI } from '../../workerAgentApi'

export async function prepareTestEnviromnent(debugLogging: boolean): Promise<void> {
	const config: { process: ProcessConfig } = {
		process: {
			certificates: [],
			logPath: undefined,
			unsafeSSL: false,
			logLevel: debugLogging ? LogLevel.DEBUG : LogLevel.INFO,
		},
	}

	initializeLogger(config)
}

export async function setupAppContainer(partialAppContainerConfig: Partial<AppContainerConfig>): Promise<AppContainer> {
	const config = literal<AppContainerProcessConfig>({
		appContainer: deepExtend(
			{
				appContainerId: protectString('app0'),
				maxAppKeepalive: 1000,
				maxRunningApps: 10,
				minRunningApps: 1,
				port: 9090,
				spinDownTime: 1000,
				minCriticalWorkerApps: 0,
				worker: {
					considerCPULoad: null,
					costMultiplier: 1,
					networkIds: [],
					resourceId: '',
					windowsDriveLetters: [],
				},
				workforceURL: null,
			},
			partialAppContainerConfig
		),
		process: {
			certificates: [],
			logLevel: undefined,
			logPath: undefined,
			unsafeSSL: false,
		},
	})

	const logger = setupLogger(config, '', undefined, undefined, undefined, (level) => level === LogLevel.ERROR)

	return new AppContainer(logger, config)
}

export async function setupWorkers(): Promise<void> {
	mockOnNewProcess((cp: any) => {
		setImmediate(() => {
			const match = cp.args.find((arg: string) => arg.match(/--workerId=(\w+)/))
			expect(match).toBeTruthy()
			const workerIdMatch = match.match(/--workerId=(\w+)/)
			// @ts-ignore mock
			WebsocketServer.mockNewConnection(workerIdMatch[1], 'workerAgent')
		})
	})
}

export function getWorkerCount() {
	const processes = mockListAllProcesses()
	return processes.filter((item: any) => item.args.find((arg: string) => arg.match(/--workerId/))).length
}

export function getWorkerId(index: number): WorkerAgentId | undefined {
	//@ts-ignore mock
	return Object.keys(WorkerAgentAPI.mockAppContainer)[index]
}

export async function resetMocks(): Promise<void> {
	mockClearAllProcesses()
	//@ts-ignore mock
	WorkerAgentAPI.mockReset()
}
