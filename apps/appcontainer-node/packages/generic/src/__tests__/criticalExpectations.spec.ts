jest.mock('child_process')
jest.mock('../workforceApi.ts')
jest.mock('../workerAgentApi.ts')

//@ts-ignore mock
import { mockListAllProcesses, mockClearAllProcesses } from 'child_process'
import { prepareTestEnviromnent, setupAppContainer, setupWorkers } from './lib/setupEnv'
import { WorkforceAPI } from '../workforceApi'
import { getFileCopyExpectation } from './lib/containers'
import { sleep } from '@sofie-automation/server-core-integration'
import { WorkerAgentAPI } from '../workerAgentApi'

jest.setTimeout(10000)

describe('Critical worker Apps', () => {
	beforeAll(async () => {
		await prepareTestEnviromnent(false)
	})

	afterEach(async () => {
		mockClearAllProcesses()
	})

	it('Spins up 2 critical expectaiton workers', async () => {
		const MIN_RUNNING_APPS = 0
		const MIN_CRITICAL_WORKER_APPS = 2
		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			minCriticalWorkerApps: MIN_CRITICAL_WORKER_APPS,
		})

		await appContainer.init()

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS + MIN_CRITICAL_WORKER_APPS)

		appContainer.terminate()
	})

	it('Spins up 2 critical expectaiton workers and one regular worker', async () => {
		const MIN_RUNNING_APPS = 1
		const MIN_CRITICAL_WORKER_APPS = 2
		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			minCriticalWorkerApps: MIN_CRITICAL_WORKER_APPS,
		})

		await appContainer.init()

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS + MIN_CRITICAL_WORKER_APPS)

		appContainer.terminate()
	})

	it('Refuses to spin down critical workers', async () => {
		const MIN_RUNNING_APPS = 0
		const MAX_RUNNING_APPS = 5
		const MIN_CRITICAL_WORKER_APPS = 1

		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			maxRunningApps: MAX_RUNNING_APPS,
			minCriticalWorkerApps: MIN_CRITICAL_WORKER_APPS,
		})

		await appContainer.init()

		const expectation0 = getFileCopyExpectation()

		await setupWorkers()

		// Ensure that the initial state has settled
		await sleep(500)

		expect(getWorkerCount()).toBe(MIN_CRITICAL_WORKER_APPS)

		{
			// @ts-ignore
			const result0 = await WorkforceAPI.mockMethods.requestAppTypeForExpectation(expectation0)

			console.log(result0)

			expect(result0.success).toBeTruthy()
		}

		expect(getWorkerCount()).toBe(MIN_CRITICAL_WORKER_APPS)

		//@ts-ignore mock
		await WorkerAgentAPI.mockAppContainer.requestSpinDown()

		expect(getWorkerCount()).toBe(MIN_CRITICAL_WORKER_APPS)

		appContainer.terminate()
	})
})

function getWorkerCount() {
	const processes = mockListAllProcesses()
	return processes.filter((item: any) => item.args.find((arg: string) => arg.match(/--workerId/))).length
}
