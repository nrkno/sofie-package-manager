import fsOrg from 'fs'
import { promisify } from 'util'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import { Expectation, literal } from '@shared/api'
import type * as fsMockType from '../__mocks__/fs'
import { prepareTestEnviromnent, TestEnviromnent } from './lib/setupEnv'
import { waitTime } from './lib/lib'
import { getLocalSource, getLocalTarget } from './lib/containers'
import { WorkerAgent } from '@shared/worker'
jest.mock('fs')
jest.mock('child_process')
jest.mock('windows-network-drive')
jest.mock('tv-automation-quantel-gateway-client')

const fs = (fsOrg as any) as typeof fsMockType

const fsStat = promisify(fs.stat)

// const fsStat = promisify(fs.stat)

describe('Handle unhappy paths', () => {
	let env: TestEnviromnent

	beforeAll(async () => {
		env = await prepareTestEnviromnent(false) // set to true to enable debug-logging
		// Verify that the fs mock works:
		expect(fs.lstat).toBeTruthy()
		expect(fs.__mockReset).toBeTruthy()

		jest.setTimeout(env.WAIT_JOB_TIME * 10 + env.WAIT_SCAN_TIME * 2)
	})
	afterAll(() => {
		env.terminate()
	})

	beforeEach(() => {
		fs.__mockReset()
		env.reset()
	})

	test('Wait for non-existing local file', async () => {
		fs.__mockSetDirectory('/sources/source0/')
		fs.__mockSetDirectory('/targets/target0')
		addCopyFileExpectation(
			env,
			'copy0',
			[getLocalSource('source0', 'file0Source.mp4')],
			[getLocalTarget('target0', 'file0Target.mp4')]
		)

		await waitTime(env.WAIT_JOB_TIME)

		// Expect the Expectation to be waiting:
		expect(env.expectationStatuses['copy0']).toMatchObject({
			actualVersionHash: null,
			statusInfo: {
				status: /new|waiting/,
				statusReason: {
					tech: /not able to access file/i,
				},
			},
		})

		// Now the file suddenly pops up:
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

		await waitTime(env.WAIT_SCAN_TIME)
		await waitTime(env.ERROR_WAIT_TIME)
		await waitTime(env.WAIT_JOB_TIME)

		// Expect the copy to have completed by now:
		expect(env.containerStatuses['target0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
			ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		)
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')
		expect(await fsStat('/targets/target0/file0Target.mp4')).toMatchObject({
			size: 1234,
		})
	})
	test.skip('Wait for non-existing network-shared, file', async () => {
		// To be written

		// Handle Drive-letters: Issue when when files aren't found? (Johan knows)

		expect(1).toEqual(1)
	})
	test.skip('Wait for growing file', async () => {
		// To be written
		expect(1).toEqual(1)
	})
	test.skip('Wait for non-existing file', async () => {
		// To be written
		expect(1).toEqual(1)
	})
	test('Wait for read access on source', async () => {
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234, {
			accessRead: false,
			accessWrite: false,
		})
		fs.__mockSetDirectory('/targets/target0', {
			accessRead: true,
			accessWrite: false,
		})
		// fs.__printAllFiles()

		addCopyFileExpectation(
			env,
			'copy0',
			[getLocalSource('source0', 'file0Source.mp4')],
			[getLocalTarget('target0', 'file0Target.mp4')]
		)

		await waitTime(env.WAIT_JOB_TIME)
		// Expect the Expectation to be waiting:
		expect(env.expectationStatuses['copy0']).toMatchObject({
			actualVersionHash: null,
			statusInfo: {
				status: /new|waiting/,
				statusReason: {
					tech: /not able to access file/i,
				},
			},
		})

		// Now the file can be read from:
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)
		await waitTime(env.ERROR_WAIT_TIME)
		await waitTime(env.WAIT_SCAN_TIME)

		// Expect the Expectation to be waiting:
		expect(env.expectationStatuses['copy0']).toMatchObject({
			actualVersionHash: null,
			statusInfo: {
				status: 'new',
				statusReason: {
					tech: /not able to access target/i,
				},
			},
		})

		// Now the target can be written to:
		fs.__mockSetDirectory('/targets/target0', {
			accessRead: true,
			accessWrite: true,
		})
		await waitTime(env.WAIT_SCAN_TIME)

		// Expect the copy to have completed by now:

		expect(env.containerStatuses['target0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
			ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		)
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')
		expect(await fsStat('/targets/target0/file0Target.mp4')).toMatchObject({
			size: 1234,
		})
	})
	test.skip('Wait for write access on target', async () => {
		// To be written
		expect(1).toEqual(1)
	})
	test.skip('Expectation changed', async () => {
		// Expectation is changed while waiting for a file
		// Expectation is changed while work-in-progress
		// Expectation is changed after fullfilled

		// To be written
		expect(1).toEqual(1)
	})
	test.skip('Aborting a job', async () => {
		// Expectation is aborted while waiting for a file
		// Expectation is aborted while work-in-progress
		// Expectation is aborted after fullfilled

		// To be written
		expect(1).toEqual(1)
	})
	test.skip('Restarting a job', async () => {
		// Expectation is restarted while waiting for a file
		// Expectation is restarted while work-in-progress
		// Expectation is restarted after fullfilled

		// To be written
		expect(1).toEqual(1)
	})
	test('A worker crashes', async () => {
		// A worker crashes while expectation waiting for a file
		// A worker crashes while expectation work-in-progress

		expect(env.workerAgents).toHaveLength(1)
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)
		fs.__mockSetDirectory('/targets/target0')
		let killedWorker: WorkerAgent | undefined
		const listenToCopyFile = jest.fn(() => {
			// While the copy is underway, kill off the worker:
			// This simulates that the worker crashes, without telling anyone.
			killedWorker = env.workerAgents[0]
			killedWorker.terminate()
		})

		fs.__emitter().once('copyFile', listenToCopyFile)

		addCopyFileExpectation(
			env,
			'copy0',
			[getLocalSource('source0', 'file0Source.mp4')],
			[getLocalTarget('target0', 'file0Target.mp4')]
		)

		await waitTime(env.WAIT_JOB_TIME)
		// Expect the Expectation to be still working
		// (the worker has crashed, but expectationManger hasn't noticed yet)
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('working')
		expect(listenToCopyFile).toHaveBeenCalledTimes(1)

		await waitTime(env.WORK_TIMEOUT_TIME)
		await waitTime(env.WAIT_JOB_TIME)
		// By now, the work should have been aborted, and restarted:
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual(expect.stringMatching(/new|waiting/))

		// Add another worker:
		env.addWorker()
		await waitTime(env.WAIT_SCAN_TIME)

		// Expect the copy to have completed by now:
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')
		expect(env.containerStatuses['target0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
			ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		)

		// Clean up:
		if (killedWorker) env.removeWorker(killedWorker.id)
	})
	test('A job times out', async () => {
		// A worker crashes while expectation waiting for a file
		// A worker crashes while expectation work-in-progress

		expect(env.workerAgents).toHaveLength(1)
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)
		fs.__mockSetDirectory('/targets/target0')
		let hasIntercepted = 0
		let deferredCallbacks: Function[] = []
		const listenToCopyFile = jest.fn(() => {
			fs.__setCallbackInterceptor((type, cb) => {
				if (type === 'copyFile') {
					hasIntercepted++
					// We will NOT call the callback cb(), this simulates that something gets stuck

					// Restore this interceptor, so that it is only runned once
					fs.__restoreCallbackInterceptor()
					// to be cleaned up later:
					deferredCallbacks.push(cb)
				} else {
					return cb()
				}
			})
		})
		fs.__emitter().once('copyFile', listenToCopyFile)

		addCopyFileExpectation(
			env,
			'copy0',
			[getLocalSource('source0', 'file0Source.mp4')],
			[getLocalTarget('target0', 'file0Target.mp4')]
		)

		await waitTime(env.WAIT_JOB_TIME)
		// Expect the Expectation to be still working
		// (the job is timing out, but expectationManger hasn't noticed yet)
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('working')
		expect(listenToCopyFile).toHaveBeenCalledTimes(1)
		expect(hasIntercepted).toBe(1)

		await waitTime(env.WORK_TIMEOUT_TIME)
		await waitTime(env.WAIT_JOB_TIME)
		// By now, the work should have been aborted, and restarted:
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual(
			expect.stringMatching(/new|waiting|fulfilled/)
		)

		await waitTime(env.WAIT_SCAN_TIME)

		// Expect the copy to have completed by now:
		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')
		expect(env.containerStatuses['target0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
		expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
			ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		)
		// clean up:
		deferredCallbacks.forEach((cb) => cb())
	})
	test.skip('One of the workers reply very slowly', async () => {
		// The expectation should be picked up by one of the faster workers

		// To be written
		expect(1).toEqual(1)
	})
})
function addCopyFileExpectation(
	env: TestEnviromnent,
	expectationId: string,
	sources: Expectation.SpecificPackageContainerOnPackage.File[],
	targets: [Expectation.SpecificPackageContainerOnPackage.File]
) {
	env.expectationManager.updateExpectations({
		copy0: literal<Expectation.FileCopy>({
			id: expectationId,
			priority: 0,
			managerId: 'manager0',
			fromPackages: [{ id: 'package0', expectedContentVersionHash: 'abcd1234' }],
			type: Expectation.Type.FILE_COPY,
			statusReport: {
				label: `Copy file0`,
				description: `Copy file0 because test`,
				requiredForPlayout: true,
				displayRank: 0,
				sendReport: true,
			},
			startRequirement: {
				sources: sources,
			},
			endRequirement: {
				targets: targets,
				content: {
					filePath: 'file0Target.mp4',
				},
				version: { type: Expectation.Version.Type.FILE_ON_DISK },
			},
			workOptions: {},
		}),
	})
}

export {} // Just to get rid of a "not a module" warning
