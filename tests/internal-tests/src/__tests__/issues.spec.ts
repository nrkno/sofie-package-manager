import fsOrg from 'fs'
import { promisify } from 'util'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import {
	Expectation,
	ExpectationId,
	ExpectationManagerId,
	ExpectedPackageId,
	PackageContainerId,
	literal,
	protectString,
	INNER_ACTION_TIMEOUT,
} from '@sofie-package-manager/api'
import type * as fsMockType from '../__mocks__/fs'
import { prepareTestEnvironment, TestEnvironment } from './lib/setupEnv'
import { waitUntil, waitTime, describeForAllPlatforms } from './lib/lib'
import { getLocalSource, getLocalTarget } from './lib/containers'
import { WorkerAgent } from '@sofie-package-manager/worker'

jest.mock('fs')
jest.mock('child_process')
jest.mock('windows-network-drive')
jest.mock('tv-automation-quantel-gateway-client')
jest.mock('@parcel/watcher')
jest.mock('proper-lockfile')

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

const MANAGER0 = protectString<ExpectationManagerId>('manager0')
const EXP_copy0 = protectString<ExpectationId>('copy0')
const PACKAGE0 = protectString<ExpectedPackageId>('package0')

const SOURCE0 = protectString<PackageContainerId>('source0')
const TARGET0 = protectString<PackageContainerId>('target0')
const TARGET1 = protectString<PackageContainerId>('target1')

let env: TestEnvironment
describeForAllPlatforms(
	'Handle unhappy paths',
	() => {
		beforeAll(async () => {
			env = await prepareTestEnvironment(false) // set to true to enable debug-logging
			// Verify that the fs mock works:
			expect(fs.lstat).toBeTruthy()
			expect(fs.__mockReset).toBeTruthy()

			jest.setTimeout(env.WAIT_JOB_TIME_SAFE * 10 + env.WAIT_SCAN_TIME * 2)
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

			fs.__emitter().removeAllListeners()
			fs.__restoreCallbackInterceptor()
		})
	},
	(_platform: string) => {
		test('Wait for non-existing local file', async () => {
			fs.__mockSetDirectory('/sources/source0/')
			fs.__mockSetDirectory('/targets/target0')
			addCopyFileExpectation(
				env,
				EXP_copy0,
				[getLocalSource(SOURCE0, 'file0Source.mp4')],
				[getLocalTarget(TARGET0, 'file0Target.mp4')]
			)

			await waitUntil(() => {
				// Expect the Expectation to be waiting:
				expect(env.expectationStatuses[EXP_copy0]).toMatchObject({
					actualVersionHash: null,
					statusInfo: {
						status: expect.stringMatching(/new|waiting/),
						statusReason: {
							tech: expect.stringMatching(/not able to access file/i),
						},
					},
				})
			}, env.WAIT_JOB_TIME_SAFE)

			expect(env.containerStatuses[TARGET0].packages[PACKAGE0].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_FOUND
			)

			// Now the file suddenly pops up:
			fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

			// Wait for the job to complete:
			await waitUntil(() => {
				// Expect the copy to have completed by now:
				expect(env.containerStatuses[TARGET0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				)
			}, env.WAIT_SCAN_TIME + env.ERROR_WAIT_TIME + env.WAIT_JOB_TIME_SAFE)

			expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')
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
				EXP_copy0,
				[getLocalSource(SOURCE0, 'file0Source.mp4')],
				[getLocalTarget(TARGET0, 'file0Target.mp4')]
			)

			await waitUntil(() => {
				// Expect the Expectation to be waiting:
				expect(env.expectationStatuses[EXP_copy0]).toMatchObject({
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
			// No read access on source:
			fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234, {
				accessRead: false,
				accessWrite: false,
			})

			// No write access on target:
			fs.__mockSetDirectory('/targets/target0', {
				accessRead: true,
				accessWrite: false,
			})

			addCopyFileExpectation(
				env,
				EXP_copy0,
				[getLocalSource(SOURCE0, 'file0Source.mp4')],
				[getLocalTarget(TARGET0, 'file0Target.mp4')]
			)

			await waitUntil(() => {
				// Expect the Expectation to be waiting:
				expect(env.expectationStatuses[EXP_copy0]).toMatchObject({
					actualVersionHash: null,
					statusInfo: {
						status: expect.stringMatching(/new|waiting/),
						statusReason: {
							tech: expect.stringMatching(/not able to access file/i),
						},
					},
				})
			}, env.WAIT_JOB_TIME_SAFE)

			// Now the file can be read from:
			fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

			await waitTime(env.WAIT_SCAN_TIME)

			await waitUntil(() => {
				// Expect the Expectation to be waiting:
				expect(env.expectationStatuses[EXP_copy0]).toMatchObject({
					actualVersionHash: null,
					statusInfo: {
						status: 'waiting',
						statusReason: {
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
				expect(env.containerStatuses[TARGET0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				)
			}, env.WAIT_JOB_TIME_SAFE)

			expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')
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
			// Expectation is changed after fulfilled

			// To be written
			expect(1).toEqual(1)
		})
		test.skip('Aborting a job', async () => {
			// Expectation is aborted while waiting for a file
			// Expectation is aborted while work-in-progress
			// Expectation is aborted after fulfilled

			// To be written
			expect(1).toEqual(1)
		})
		test.skip('Restarting a job', async () => {
			// Expectation is restarted while waiting for a file
			// Expectation is restarted while work-in-progress
			// Expectation is restarted after fulfilled

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
				EXP_copy0,
				[getLocalSource(SOURCE0, 'file0Source.mp4')],
				[getLocalTarget(TARGET0, 'file0Target.mp4')]
			)

			await waitTime(env.WAIT_JOB_TIME)
			// Expect the Expectation to be still working
			// (the worker has crashed, but expectationManger hasn't noticed yet)
			expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('working')
			expect(listenToCopyFile).toHaveBeenCalledTimes(1)

			// Wait until the work have been aborted, and restarted:
			await waitUntil(() => {
				expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual(
					expect.stringMatching(/new|waiting/)
				)
			}, env.WORK_TIMEOUT_TIME + env.WAIT_JOB_TIME_SAFE)

			// Add another worker:
			env.addWorker()

			// Expect the copy to have completed:
			await waitUntil(() => {
				expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')
				expect(env.containerStatuses[TARGET0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0].packageStatus?.status).toEqual(
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
				EXP_copy0,
				[getLocalSource(SOURCE0, 'file0Source.mp4')],
				[getLocalTarget(TARGET0, 'file0Target.mp4')]
			)

			await waitTime(env.WAIT_JOB_TIME)
			// Expect the Expectation to be still working
			// (the job is timing out, but expectationManger hasn't noticed yet)
			expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('working')
			expect(listenToCopyFile).toHaveBeenCalledTimes(1)
			expect(hasIntercepted).toBe(1)

			// Wait for the work to be aborted, and restarted:
			await waitUntil(() => {
				expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual(
					expect.stringMatching(/new|waiting|ready|fulfilled/)
				)
			}, env.WORK_TIMEOUT_TIME + env.WAIT_JOB_TIME_SAFE)

			// Wait for the copy to complete:
			await waitUntil(() => {
				expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')
				expect(env.containerStatuses[TARGET0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				)
			}, env.WAIT_SCAN_TIME)

			expect(listenToCopyFile).toHaveBeenCalledTimes(1)
			expect(hasIntercepted).toBe(1)

			// clean up:
			deferredCallbacks.forEach((cb) => cb())
		})
		test('Access times out, queue should continue', async () => {
			expect(env.workerAgents).toHaveLength(1)

			const listenToOpen = jest.fn(() => {
				fs.__setCallbackInterceptor((type, cb) => {
					if (type === 'open') {
						// Delay the access
						setTimeout(() => {
							cb()
						}, 1000)
					} else {
						return cb()
					}
				})
			})
			fs.__emitter().on('open', listenToOpen)

			const expectationList: Array<Expectation.Any> = []
			fs.__mockSetDirectory('/targets/target0')
			for (let i = 0; i < 100; i++) {
				fs.__mockSetFile(`/sources/source0/file${i}Source.mp4`, 1234)

				const expectationId = protectString<ExpectationId>(`copy${i}`)
				expectationList.push(
					literal<Expectation.FileCopy>({
						id: expectationId,
						priority: 0,
						managerId: MANAGER0,
						fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
						type: Expectation.Type.FILE_COPY,
						statusReport: {
							label: `Copy file "${expectationId}"`,
							description: `Copy "${expectationId}" because test`,
							displayRank: 0,
							sendReport: true,
						},
						startRequirement: {
							sources: [getLocalSource(SOURCE0, `file${i}Source.mp4`)],
						},
						endRequirement: {
							targets: [getLocalTarget(TARGET0, `file${i}Target.mp4`)],
							content: {
								filePath: `file${i}Target.mp4`,
							},
							version: { type: Expectation.Version.Type.FILE_ON_DISK },
						},
						workOptions: {
							requiredForPlayout: true,
						},
					})
				)
			}

			const expectations: Record<ExpectationId, Expectation.Any> = {}
			expectationList.slice(0, 9999).forEach((exp) => {
				expectations[exp.id] = exp
			})
			env.expectationManager.updateExpectations(expectations)

			expect(env.PARALLEL_CONCURRENCY).toBe(10)
			expect(env.ALLOW_SKIPPING_QUEUE_TIME).toBe(3000)

			// What we're expecting to happen:
			// * We've got 100 expectations.
			// * The Expectations take 1 second to fs.open (which is done during WAITING)
			// * The Expectations are evaluated in batches of 10
			// * After 3s, expectationManager should decide to skip ahead from evaluating the WAITING expectations
			// So a short while later, we should see that some of the expectations have been fulfilled

			const getStatusCount = () => {
				const statusCount: Record<string, number> = {
					new: 0,
					waiting: 0,
					ready: 0,
					working: 0,
					fulfilled: 0,
				}
				Object.values(env.expectationStatuses).forEach((v) => {
					if (v.statusInfo.status) {
						statusCount[v.statusInfo.status] = (statusCount[v.statusInfo.status] || 0) + 1
					}
				})
				return statusCount
			}
			{
				await waitTime(1000) // 1000
				// At this time, no expectations should have moved past the WAITING state yet
				const statuses = getStatusCount()
				expect(statuses['waiting']).toBe(100)
			}
			{
				await waitTime(1000) // 2000
				// At this time, some expectations should have moved past the WAITING state
				const statuses = getStatusCount()
				expect(statuses['waiting']).toBeGreaterThan(50)
				expect(statuses['ready']).toBeGreaterThanOrEqual(10)
				expect(statuses['working']).toBe(0)
				expect(statuses['fulfilled']).toBe(0)
			}
			{
				await waitTime(1000) // 3000
				// By this time, expectationManager should have skipped ahead and processed more states

				const statuses = getStatusCount()
				expect(statuses['fulfilled']).toBeGreaterThanOrEqual(1)
			}
		}, 5000)
		test('Worker should try to restart itself after errors', async () => {
			const FAILURE_PERIOD = 300
			const FAILURE_COUNT = 3

			expect(env.workerAgents).toHaveLength(1)
			await env.removeWorker(env.workerAgents[0].id)
			await env.addWorker({
				// 3 * 1000 = 3000 ms to restart
				failurePeriod: FAILURE_PERIOD,
				failurePeriodLimit: FAILURE_COUNT,
			})

			fs.__mockSetDirectory('/sources/source0/')
			fs.__mockSetDirectory('/targets/target0')
			fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

			const listenToOpen = jest.fn(() => {
				fs.__setCallbackInterceptor((type, cb) => {
					if (type === 'open') {
						// throw upon open:
						cb(new Error('Simulated error in unit test'))
					} else {
						return cb()
					}
				})
			})
			fs.__emitter().on('open', listenToOpen)

			const failurePeriodSpinDown = jest.fn()

			env.setLogFilterFunction((level, ...args) => {
				const str = args.join(',')

				// Catch message "Worker ErrorCheck: Failed failurePeriodLimit check: 4 periods with errors. Requesting spin down."

				if (
					level === 'error' &&
					str.match(/Worker ErrorCheck: Failed failurePeriodLimit check.*Requesting spin down/)
				) {
					failurePeriodSpinDown()
					return true
				}
				return true
			})

			addCopyFileExpectation(
				env,
				EXP_copy0,
				[getLocalSource(SOURCE0, 'file0Source.mp4')],
				[getLocalTarget(TARGET0, 'file0Target.mp4')]
			)

			// Because the fs.open will throw, the worker should try to restart itself
			// withing 3*1000 ms

			await waitUntil(() => {
				expect(failurePeriodSpinDown.mock.calls.length).toBeGreaterThanOrEqual(1)
			}, FAILURE_COUNT * FAILURE_PERIOD + env.WAIT_JOB_TIME_SAFE)

			// Afterwards:
			// Remove the worker from this test, and re-add a default one:
			expect(env.workerAgents).toHaveLength(1)
			await env.removeWorker(env.workerAgents[0].id)
			await env.addWorker()

			// await sleep(500)
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

			const STEP1 = protectString<ExpectationId>('step1')
			const STEP2 = protectString<ExpectationId>('step2')

			env.expectationManager.updateExpectations({
				[STEP1]: literal<Expectation.FileCopy>({
					id: STEP1,
					priority: 0,
					managerId: MANAGER0,
					fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
					type: Expectation.Type.FILE_COPY,
					statusReport: {
						label: `Copy file0`,
						description: '',
						sendReport: true,
					},
					startRequirement: {
						sources: [getLocalSource(SOURCE0, 'file0Source.mp4')],
					},
					endRequirement: {
						targets: [getLocalTarget(TARGET0, 'myFolder/file0Target.mp4')],
						content: {
							filePath: 'file0Target.mp4',
						},
						version: { type: Expectation.Version.Type.FILE_ON_DISK },
					},
					workOptions: {},
				}),
				[STEP2]: literal<Expectation.FileCopy>({
					id: STEP2,
					dependsOnFulfilled: [STEP1], // Depends on step 1
					priority: 0,
					managerId: MANAGER0,
					fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
					type: Expectation.Type.FILE_COPY,
					statusReport: {
						label: `Copy file0`,
						description: '',
						sendReport: true,
					},
					startRequirement: {
						sources: [getLocalTarget(TARGET0, 'myFolder/file0Target.mp4')],
					},
					endRequirement: {
						targets: [getLocalTarget(TARGET1, 'myFolder/file0Target.mp4')],
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
				expect(env.containerStatuses[TARGET0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				)
			}, env.WAIT_JOB_TIME_SAFE)
			await waitUntil(() => {
				expect(env.containerStatuses[TARGET1]).toBeTruthy()
				expect(env.containerStatuses[TARGET1].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				)
			}, env.WAIT_JOB_TIME_SAFE)

			// Check that step 1 and 2 fulfills:
			expect(env.expectationStatuses[STEP1].statusInfo.status).toEqual('fulfilled')
			expect(env.expectationStatuses[STEP2].statusInfo.status).toEqual('fulfilled')

			expect(await fsExists('/targets/target0/myFolder/file0Target.mp4')).toBe(true)

			expect(await fsStat('/targets/target0/myFolder/file0Target.mp4')).toMatchObject({
				size: 1234,
			})
			expect(await fsStat('/targets/target1/myFolder/file0Target.mp4')).toMatchObject({
				size: 1234,
			})

			// Now A is removed, so step 1 should be un-fulfilled
			fs.__mockDeleteFile('/sources/source0/file0Source.mp4')

			// Wait for the step 1 to pick up on the change:
			await waitUntil(() => {
				expect(env.expectationStatuses[STEP1].statusInfo.status).toMatch(/waiting|new/)
				expect(env.containerStatuses[TARGET0].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.NOT_FOUND
				)
			}, env.WAIT_JOB_TIME_SAFE)

			// Step 2 should be un-fulfilled, since it depends on step 1.
			await waitUntil(() => {
				expect(env.expectationStatuses[STEP1].statusInfo.status).toMatch(/waiting|new/)
				expect(env.expectationStatuses[STEP2].statusInfo.status).toMatch(/waiting|new/)
			}, env.WAIT_JOB_TIME_SAFE)

			// The step1-copied file should remain, since removePackageOnUnFulfill is not set
			expect(await fsExists('/targets/target0/myFolder/file0Target.mp4')).toBe(true)
			// The step2-copied file should be removed, since removePackageOnUnFulfill is true
			expect(await fsExists('/targets/target1/myFolder/file0Target.mp4')).toBe(false)

			// Source file shows up again:
			fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)

			// Now, both steps should fulfill again:
			await waitUntil(() => {
				expect(env.expectationStatuses[STEP1].statusInfo.status).toBe('fulfilled')
				expect(env.expectationStatuses[STEP2].statusInfo.status).toBe('fulfilled')
			}, env.WAIT_JOB_TIME_SAFE)
		})
	}
)
function addCopyFileExpectation(
	env: TestEnvironment,
	expectationId: ExpectationId,
	sources: Expectation.SpecificPackageContainerOnPackage.FileSource[],
	targets: [Expectation.SpecificPackageContainerOnPackage.FileTarget]
) {
	const COPY0 = protectString<ExpectationId>('copy0')
	env.expectationManager.updateExpectations({
		[COPY0]: literal<Expectation.FileCopy>({
			id: expectationId,
			priority: 0,
			managerId: MANAGER0,
			fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
			type: Expectation.Type.FILE_COPY,
			statusReport: {
				label: `Copy file "${expectationId}"`,
				description: `Copy "${expectationId}" because test`,
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
			workOptions: {
				requiredForPlayout: true,
			},
		}),
	})
}

export {} // Just to get rid of a "not a module" warning
