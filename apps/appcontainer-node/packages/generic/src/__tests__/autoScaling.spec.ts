jest.mock('child_process')
jest.mock('../workforceApi.ts')
jest.mock('../workerAgentApi.ts')

//@ts-ignore mock
import { mockListAllProcesses, mockClearAllProcesses } from 'child_process'
import { prepareTestEnviromnent, setupAppContainer, setupWorkers } from './lib/setupEnv'
import { WorkforceAPI } from '../workforceApi'
import { getFileCopyExpectation, getPackageContainerExpectation } from './lib/containers'
import { sleep } from '@sofie-automation/server-core-integration'
import { WorkerAgentAPI } from '../workerAgentApi'

jest.setTimeout(10000)

describe('Auto-scaling', () => {
	beforeAll(async () => {
		await prepareTestEnviromnent(false)
	})

	afterEach(async () => {
		mockClearAllProcesses()
	})

	it('Spins up 2 as the minimal amount of workers', async () => {
		const MIN_RUNNING_APPS = 2
		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS)

		appContainer.terminate()
	})

	it('Spins up 0 as the minimal amount of workers', async () => {
		const MIN_RUNNING_APPS = 0
		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS)

		appContainer.terminate()
	})

	it('Responds to requests to spin up new workers if needed for an expectation', async () => {
		const MIN_RUNNING_APPS = 0
		const MAX_RUNNING_APPS = 5
		const TARGET_RUNNING_APPS = 1

		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			maxRunningApps: MAX_RUNNING_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		const expectation0 = getFileCopyExpectation()

		// Ensure that the initial state has settled
		await sleep(500)

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS)

		{
			// @ts-ignore
			const result0 = await WorkforceAPI.mockMethods.requestAppTypeForExpectation(expectation0)

			expect(result0.success).toBeTruthy()
		}

		expect(getWorkerCount()).toBe(TARGET_RUNNING_APPS)

		appContainer.terminate()
	})

	it('Responds to requests to spin up new workers if needed for a package container', async () => {
		const MIN_RUNNING_APPS = 0
		const MAX_RUNNING_APPS = 5
		const TARGET_RUNNING_APPS = 1

		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			maxRunningApps: MAX_RUNNING_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		const expectation0 = getPackageContainerExpectation()

		// Ensure that the initial state has settled
		await sleep(500)

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS)

		{
			// @ts-ignore
			const result0 = await WorkforceAPI.mockMethods.requestAppTypeForPackageContainer(expectation0)

			expect(result0.success).toBeTruthy()
		}

		expect(getWorkerCount()).toBe(TARGET_RUNNING_APPS)

		appContainer.terminate()
	})

	it('Refuses to start up new workers if already at `maxRunningApps`', async () => {
		const MIN_RUNNING_APPS = 0
		const MAX_RUNNING_APPS = 0
		const TARGET_RUNNING_APPS = 0

		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			maxRunningApps: MAX_RUNNING_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		const expectation0 = getFileCopyExpectation()

		// Ensure that the initial state has settled
		await sleep(500)

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS)

		{
			// @ts-ignore
			const result0 = await WorkforceAPI.mockMethods.requestAppTypeForExpectation(expectation0)

			expect(result0.success).toBeFalsy()
		}

		expect(getWorkerCount()).toBe(TARGET_RUNNING_APPS)

		appContainer.terminate()
	})

	it('Spins down workers if requested and more than `minRunningApps`', async () => {
		const MIN_RUNNING_APPS = 0
		const MAX_RUNNING_APPS = 5
		const INTERMEDIATE_RUNNING_APPS = 1
		const TARGET_RUNNING_APPS = 0

		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			maxRunningApps: MAX_RUNNING_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		const expectation0 = getFileCopyExpectation()

		// Ensure that the initial state has settled
		await sleep(500)

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS)

		{
			// @ts-ignore
			const result0 = await WorkforceAPI.mockMethods.requestAppTypeForExpectation(expectation0)

			expect(result0.success).toBeTruthy()
		}

		expect(getWorkerCount()).toBe(INTERMEDIATE_RUNNING_APPS)

		//@ts-ignore mock
		await WorkerAgentAPI.mockAppContainer['app0_0'].requestSpinDown()

		expect(getWorkerCount()).toBe(TARGET_RUNNING_APPS)

		appContainer.terminate()
	})

	it('Refuses to spin down workers if requested and less than `minRunningApps`', async () => {
		const MIN_RUNNING_APPS = 1
		const MAX_RUNNING_APPS = 5
		const INTERMEDIATE_RUNNING_APPS = 1
		const TARGET_RUNNING_APPS = 1

		const appContainer = await setupAppContainer({
			minRunningApps: MIN_RUNNING_APPS,
			maxRunningApps: MAX_RUNNING_APPS,
		})

		await setupWorkers()

		await appContainer.init()

		const expectation0 = getFileCopyExpectation()

		// Ensure that the initial state has settled
		await sleep(500)

		expect(getWorkerCount()).toBe(MIN_RUNNING_APPS)

		{
			// @ts-ignore
			const result0 = await WorkforceAPI.mockMethods.requestAppTypeForExpectation(expectation0)

			expect(result0.success).toBeTruthy()
		}

		expect(getWorkerCount()).toBe(INTERMEDIATE_RUNNING_APPS)

		//@ts-ignore mock
		await WorkerAgentAPI.mockAppContainer['app0_0'].requestSpinDown()

		expect(getWorkerCount()).toBe(TARGET_RUNNING_APPS)

		appContainer.terminate()
	})
})

function getWorkerCount() {
	const processes = mockListAllProcesses()
	return processes.filter((item: any) => item.args.find((arg: string) => arg.match(/--workerId/))).length
}
