import { protectString } from '@sofie-automation/server-core-integration'
import { ClientConnectionOptions, LoggerInstance, WorkerConfig, clearPrometheusRegistry } from '@sofie-package-manager/api'
import { WorkforceAPI } from '../workforceApi'
import { ExpectationManagerAPI } from '../expectationManagerApi'

jest.mock('../workforceApi.ts', () => {
	return {
		WorkforceAPI: jest.fn().mockImplementation(function () {
			let onConnected: (() => void) | null = null
			return {
				on: function (event: string, cb: (...args: any[]) => void) {
					if (event === 'connected') {
						onConnected = cb
					}
				},
				init: function () {
					return Promise.resolve().then(() => {
						onConnected?.()
					})
				},
				getExpectationManagerList: function () {
					const o = setup()
					return [
						{
							id: 'expectation-manager-id',
							urls: o.expectationManagerAccessURLs,
						},
					]
				},
			}
		}),
	}
})

const mockInit = jest.fn(function (_connectionOptions: ClientConnectionOptions, _clientMethods: any) {
	return Promise.resolve()
})

jest.mock('../expectationManagerApi.ts', () => {
	return {
		ExpectationManagerAPI: jest.fn().mockImplementation(function () {
			return {
				on: function (_event: string, _cb: (...args: any[]) => void) {
					// do nothing
				},
				init: mockInit,
			}
		}),
	}
})

import { WorkerAgent } from '../workerAgent'
import { WorkInProgress } from '../worker/lib/workInProgress'

beforeAll(() => {
	jest.useFakeTimers()
})

beforeEach(() => {
	clearPrometheusRegistry()
	mockInit.mockClear()
	;(WorkforceAPI as any as jest.Mock<WorkforceAPI>).mockClear()
	;(ExpectationManagerAPI as any as jest.Mock<ExpectationManagerAPI>).mockClear()
})

describe('WorkerAgent', () => {
	it('Connects to the ExpectationManager via the correct URL for a given networkId', async () => {
		const o = setup()
		const workerAgent = new WorkerAgent(o.logger, {
			...o.workerConfig,
			worker: {
				...o.workerConfig.worker,
				networkIds: ['net2'],
			},
		} satisfies WorkerConfig)
		await workerAgent.init()

		expect(WorkforceAPI).toHaveBeenCalledTimes(1)
		expect((WorkforceAPI as any as jest.Mock<WorkforceAPI>).mock.calls[0][0]).toBe(o.workerConfig.worker.workerId)

		expect(mockInit).toHaveBeenCalledTimes(1)
		expect(mockInit.mock.calls[0][0]).toMatchObject({
			type: 'websocket',
			url: o.expectationManagerAccessURLs['net2'],
		})
	})
	it('Connects to the ExpectationManager via the fallback URL if no networkIds provided', async () => {
		const o = setup()
		const workerAgent = new WorkerAgent(o.logger, {
			...o.workerConfig,
			worker: {
				...o.workerConfig.worker,
				networkIds: [],
			},
		} satisfies WorkerConfig)
		await workerAgent.init()

		expect(WorkforceAPI).toHaveBeenCalledTimes(1)
		expect((WorkforceAPI as any as jest.Mock<WorkforceAPI>).mock.calls[0][0]).toBe(o.workerConfig.worker.workerId)

		expect(mockInit).toHaveBeenCalledTimes(1)
		expect(mockInit.mock.calls[0][0]).toMatchObject({
			type: 'websocket',
			url: o.expectationManagerAccessURLs['*'],
		})
	})
	it('Connects to the ExpectationManager via the fallback URL if no URLs matching the networkIds found', async () => {
		const o = setup()
		const workerAgent = new WorkerAgent(o.logger, {
			...o.workerConfig,
			worker: {
				...o.workerConfig.worker,
				networkIds: ['net-nonexistent'],
			},
		} satisfies WorkerConfig)
		await workerAgent.init()

		expect(WorkforceAPI).toHaveBeenCalledTimes(1)
		expect((WorkforceAPI as any as jest.Mock<WorkforceAPI>).mock.calls[0][0]).toBe(o.workerConfig.worker.workerId)

		expect(mockInit).toHaveBeenCalledTimes(1)
		expect(mockInit.mock.calls[0][0]).toMatchObject({
			type: 'websocket',
			url: o.expectationManagerAccessURLs['*'],
		})
	})
})

describe('WorkerAgent cancelling a job', () => {
	/**
	 * Sets up a WorkerAgent with a single running job, whose work rejects when cancelled
	 * (which is what the expectationHandlers do, see eg. scan.ts).
	 */
	async function setupRunningJob() {
		const o = setup()
		const workerAgent = new WorkerAgent(o.logger, o.workerConfig)

		const managerId = protectString<any>('expectation-manager-id')
		const wipEventError = jest.fn(async () => undefined)
		const wipEventDone = jest.fn(async () => undefined)
		;(workerAgent as any).expectationManagers.set(managerId, {
			urls: {},
			api: { wipEventError, wipEventDone, wipEventProgress: jest.fn(async () => undefined) },
		})

		// eslint-disable-next-line prefer-const
		let workInProgress: WorkInProgress
		workInProgress = new WorkInProgress({ workLabel: 'Test work' }, async () => {
			// Cancelling the work causes the underlying work to reject, which is surfaced
			// as an 'error' event:
			workInProgress._reportError(new Error('Cancelled'))
		})
		;(workerAgent as any)._worker = {
			workOnExpectation: async () => workInProgress,
		}

		const exp = { id: protectString<any>('exp0'), type: 'packageDeepScan' } as any
		const wipInfo = await (workerAgent as any).createNewJobForExpectation(
			managerId,
			exp,
			{ cost: 0, startCost: 0 },
			1000
		)

		return { workerAgent, wipId: wipInfo.wipId, wipEventError, wipEventDone, logger: o.logger }
	}

	it('does not report the cancellation to the ExpectationManager as a work error', async () => {
		const { workerAgent, wipId, wipEventError } = await setupRunningJob()

		await (workerAgent as any).cancelJob(wipId)

		// A cancellation is deliberate, so it must not be reported as the work having failed:
		expect(wipEventError).toHaveBeenCalledTimes(0)
	})

	it('does not count the cancellation as a worker failure', async () => {
		const { workerAgent, wipId } = await setupRunningJob()

		await (workerAgent as any).cancelJob(wipId)

		// Counting cancellations as failures can eventually spin the worker down (failurePeriodLimit):
		expect((workerAgent as any).failureCounter).toBe(0)
	})

	it('removes the job', async () => {
		const { workerAgent, wipId } = await setupRunningJob()

		expect((workerAgent as any).currentJobs).toHaveLength(1)

		await (workerAgent as any).cancelJob(wipId)

		expect((workerAgent as any).currentJobs).toHaveLength(0)
	})
})

function setup() {
	const logger = {
		error: jest.fn((...args) => console.log(...args)),
		warn: jest.fn((...args) => console.log(...args)),
		help: jest.fn((...args) => console.log(...args)),
		data: jest.fn((...args) => console.log(...args)),
		info: jest.fn((...args) => console.log(...args)),
		debug: jest.fn((...args) => console.log(...args)),
		prompt: jest.fn((...args) => console.log(...args)),
		http: jest.fn((...args) => console.log(...args)),
		verbose: jest.fn((...args) => console.log(...args)),
		input: jest.fn((...args) => console.log(...args)),
		silly: jest.fn((...args) => console.log(...args)),
	} as any as LoggerInstance
	logger.category = () => logger

	const workerConfig = {
		process: {
			logLevel: 'debug',
			certificates: [],
			unsafeSSL: false,
			logPath: undefined,
		},
		worker: {
			appContainerURL: '', // do not connect to AppContainer in this test
			workerId: protectString<any>('worker'),
			considerCPULoad: null,
			costMultiplier: 1,
			failurePeriod: 0,
			failurePeriodLimit: 0,
			networkIds: [],
			pickUpCriticalExpectationsOnly: false,
			resourceId: 'res1',
			workforceURL: 'ws:workforce.local',
			sourcePackageStabilityThreshold: 0,
			executableAliases: {},
			temporaryFolderPath: undefined,
			windowsDriveLetters: undefined,
			allowedExpectationTypes: null,
			matchFilenamesWithoutExtension: false,
		},
		health: {
			port: null,
		},
	} satisfies WorkerConfig

	const expectationManagerAccessURLs = {
		net1: 'ws://expectation-manager.net1.local',
		net2: 'ws://expectation-manager.net2.local',
		'*': 'ws://expectation-manager.public',
	}

	return {
		logger,
		workerConfig,
		expectationManagerAccessURLs,
	}
}
