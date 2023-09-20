import fsOrg from 'fs'
import { promisify } from 'util'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { Expectation, INNER_ACTION_TIMEOUT, literal } from '@sofie-package-manager/api'
import type * as fsMockType from '../__mocks__/fs'
import { prepareTestEnviromnent, TestEnviromnent } from './lib/setupEnv'
import { waitUntil, waitTime } from './lib/lib'
import { getLocalSource, getLocalTarget } from './lib/containers'
import { WorkerAgent } from '@sofie-package-manager/worker'
jest.mock('fs')
jest.mock('mkdirp')
jest.mock('child_process')
jest.mock('windows-network-drive')
jest.mock('tv-automation-quantel-gateway-client')

const fs = fsOrg as any as typeof fsMockType

const fsAccess = promisify(fs.access)
const fsStat = promisify(fs.stat)

const fsExists = async (filePath: string) => {
	try {
		await fsAccess(filePath, fs.constants.R_OK)
		// The file exists
		return true
	} catch (err) {
		if (typeof err === 'object' && err && (err as any).code === 'ENOENT') return false
		throw err
	}
}

// const fsStat = promisify(fs.stat)

// this test can be a bit slower in CI sometimes
jest.setTimeout(30000)

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
		fs.__mockSetAccessDelay(0) // Reset any access delay
	})
	afterEach(() => {
		fs.__mockSetAccessDelay(0) // Reset any access delay
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

		await waitUntil(() => {
			// Expect the Expectation to be waiting:
			expect(env.expectationStatuses['copy0']).toMatchObject({
				actualVersionHash: null,
				statusInfo: {
					status: expect.stringMatching(/new|waiting/),
					statusReason: {
						tech: expect.stringMatching(/not able to access file/i),
					},
				},
			})
		}, env.WAIT_JOB_TIME)

		expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
			ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_FOUND
		)

		// Now the file suddenly pops up:
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

		// Wait for the job to complete:
		await waitUntil(() => {
			// Expect the copy to have completed by now:
			expect(env.containerStatuses['target0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_SCAN_TIME + env.ERROR_WAIT_TIME + env.WAIT_JOB_TIME)

		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')
		expect(await fsStat('/targets/target0/file0Target.mp4')).toMatchObject({
			size: 1234,
		})
	})
	test('Slow responding file operations', async () => {
		fs.__mockSetDirectory('/sources/source0/')
		fs.__mockSetDirectory('/targets/target0')
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)
		fs.__mockSetAccessDelay(INNER_ACTION_TIMEOUT + 100) // Simulate a slow file operation

		env.setLogFilterFunction((level, ...args) => {
			const str = args.join(',')
			// Suppress some logged warnings:
			if (level === 'warn' && str.includes('checkPackageContainerWriteAccess')) return false
			return true
		})

		addCopyFileExpectation(
			env,
			'copy0',
			[getLocalSource('source0', 'file0Source.mp4')],
			[getLocalTarget('target0', 'file0Target.mp4')]
		)

		await waitUntil(() => {
			// Expect the Expectation to be waiting:
			expect(env.expectationStatuses['copy0']).toMatchObject({
				actualVersionHash: null,
				statusInfo: {
					// status: expect.stringMatching(/fulfilled/),
					statusReason: {
						tech: expect.stringMatching(/timeout.*checkPackageContainerWriteAccess.*Accessor.*/i),
					},
				},
			})
		}, INNER_ACTION_TIMEOUT + 100)
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

		addCopyFileExpectation(
			env,
			'copy0',
			[getLocalSource('source0', 'file0Source.mp4')],
			[getLocalTarget('target0', 'file0Target.mp4')]
		)

		await waitUntil(() => {
			// Expect the Expectation to be waiting:
			expect(env.expectationStatuses['copy0']).toMatchObject({
				actualVersionHash: null,
				statusInfo: {
					status: expect.stringMatching(/new|waiting/),
					statusReason: {
						tech: expect.stringMatching(/not able to access file/i),
					},
				},
			})
		}, env.WAIT_JOB_TIME)

		// Now the file can be read from:
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

		await waitUntil(() => {
			// Expect the Expectation to be waiting -> new:
			expect(env.expectationStatuses['copy0']).toMatchObject({
				actualVersionHash: null,
				statusInfo: {
					status: 'new',
					statusReason: {
						// user: expect.stringMatching(/asdf/i),
						tech: expect.stringMatching(/Not able to write to container folder.*write access denied/i),
					},
				},
			})
		}, env.ERROR_WAIT_TIME + env.WAIT_SCAN_TIME)

		// Now the target can be written to:
		fs.__mockSetDirectory('/targets/target0', {
			accessRead: true,
			accessWrite: true,
		})

		// Wait until the copy has completed:
		await waitUntil(() => {
			expect(env.containerStatuses['target0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_JOB_TIME)

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

		env.setLogFilterFunction((level, ...args) => {
			const str = args.join(',')
			// Suppress some logged warnings:
			if (level === 'warn' && str.includes('stalled, restarting')) return false
			if (level === 'error' && str.includes('cancelling timed out work')) return false
			return true
		})

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

		// Wait until the work have been aborted, and restarted:
		await waitUntil(() => {
			expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual(expect.stringMatching(/new|waiting/))
		}, env.WORK_TIMEOUT_TIME + env.WAIT_JOB_TIME)

		// Add another worker:
		env.addWorker()

		// Expect the copy to have completed:
		await waitUntil(() => {
			expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')
			expect(env.containerStatuses['target0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_SCAN_TIME)

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

		env.setLogFilterFunction((level, ...args) => {
			const str = args.join(',')
			// Suppress some logged warnings:
			if (level === 'warn' && str.includes('stalled, restarting')) return false
			if (level === 'warn' && str.includes('Cancelling job')) return false
			return true
		})

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

		// Wait for the work to be aborted, and restarted:
		await waitUntil(() => {
			expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual(
				expect.stringMatching(/new|waiting|ready|fulfilled/)
			)
		}, env.WORK_TIMEOUT_TIME + env.WAIT_JOB_TIME)

		// Wait for the copy to complete:
		await waitUntil(() => {
			expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')
			expect(env.containerStatuses['target0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_SCAN_TIME)

		expect(listenToCopyFile).toHaveBeenCalledTimes(1)
		expect(hasIntercepted).toBe(1)

		// clean up:
		deferredCallbacks.forEach((cb) => cb())
	})
	test.skip('One of the workers reply very slowly', async () => {
		// The expectation should be picked up by one of the faster workers

		// To be written
		expect(1).toEqual(1)
	})
	test('When original work step fails, subsequent steps should do so too', async () => {
		// Step 1: Copy from A to B
		// Step 2: Copy from B to C

		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)
		fs.__mockSetDirectory('/targets/target0')
		fs.__mockSetDirectory('/targets/target1')
		// console.log(fs.__printAllFiles())

		env.expectationManager.updateExpectations({
			step1: literal<Expectation.FileCopy>({
				id: 'step1',
				priority: 0,
				managerId: 'manager0',
				fromPackages: [{ id: 'package0', expectedContentVersionHash: 'abcd1234' }],
				type: Expectation.Type.FILE_COPY,
				statusReport: {
					label: `Copy file0`,
					description: '',
					sendReport: true,
				},
				startRequirement: {
					sources: [getLocalSource('source0', 'file0Source.mp4')],
				},
				endRequirement: {
					targets: [getLocalTarget('target0', 'myFolder/file0Target.mp4')],
					content: {
						filePath: 'file0Target.mp4',
					},
					version: { type: Expectation.Version.Type.FILE_ON_DISK },
				},
				workOptions: {},
			}),
			step2: literal<Expectation.FileCopy>({
				id: 'step2',
				dependsOnFullfilled: ['step1'], // Depends on step 1
				priority: 0,
				managerId: 'manager0',
				fromPackages: [{ id: 'package0', expectedContentVersionHash: 'abcd1234' }],
				type: Expectation.Type.FILE_COPY,
				statusReport: {
					label: `Copy file0`,
					description: '',
					sendReport: true,
				},
				startRequirement: {
					sources: [getLocalTarget('target0', 'myFolder/file0Target.mp4')],
				},
				endRequirement: {
					targets: [getLocalTarget('target1', 'myFolder/file0Target.mp4')],
					content: {
						filePath: 'file0Target.mp4',
					},
					version: { type: Expectation.Version.Type.FILE_ON_DISK },
				},
				workOptions: {
					removePackageOnUnFulfill: true,
				},
			}),
		})

		// Wait for the job to complete:
		await waitUntil(() => {
			expect(env.containerStatuses['target0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_JOB_TIME)
		await waitUntil(() => {
			expect(env.containerStatuses['target1']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_JOB_TIME)

		// Check that step 1 and 2 fullfills:
		expect(env.expectationStatuses['step1'].statusInfo.status).toEqual('fulfilled')
		expect(env.expectationStatuses['step2'].statusInfo.status).toEqual('fulfilled')

		expect(await fsExists('/targets/target0/myFolder/file0Target.mp4')).toBe(true)
		expect(await fsStat('/targets/target0/myFolder/file0Target.mp4')).toMatchObject({
			size: 1234,
		})
		expect(await fsStat('/targets/target1/myFolder/file0Target.mp4')).toMatchObject({
			size: 1234,
		})

		// Now A is removed, so step 1 should be un-fullfilled
		fs.__mockDeleteFile('/sources/source0/file0Source.mp4')

		// Wait for the step 1 to pick up on the change:
		await waitUntil(() => {
			expect(env.expectationStatuses['step1'].statusInfo.status).toMatch(/waiting|new/)
			expect(env.containerStatuses['target0'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_FOUND
			)
		}, env.WAIT_JOB_TIME)

		// Step 2 should be un-fullfilled, since it depends on step 1.
		await waitUntil(() => {
			expect(env.expectationStatuses['step1'].statusInfo.status).toMatch(/waiting|new/)
			expect(env.expectationStatuses['step2'].statusInfo.status).toMatch(/waiting|new/)
		}, env.WAIT_JOB_TIME)

		// The step1-copied file should remain, since removePackageOnUnFulfill is not set
		expect(await fsExists('/targets/target0/myFolder/file0Target.mp4')).toBe(true)
		// The step2-copied file should be removed, since removePackageOnUnFulfill is true
		expect(await fsExists('/targets/target1/myFolder/file0Target.mp4')).toBe(false)

		// Source file shows up again:
		fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

		// Now, both steps should fulfill again:
		await waitUntil(() => {
			expect(env.expectationStatuses['step1'].statusInfo.status).toBe('fulfilled')
			expect(env.expectationStatuses['step2'].statusInfo.status).toBe('fulfilled')
		}, env.WAIT_JOB_TIME)
	})
})
function addCopyFileExpectation(
	env: TestEnviromnent,
	expectationId: string,
	sources: Expectation.SpecificPackageContainerOnPackage.FileSource[],
	targets: [Expectation.SpecificPackageContainerOnPackage.FileTarget]
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
