import fsOrg from 'fs'
import { promisify } from 'util'
import WNDOrg from 'windows-network-drive'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import * as QGatewayClientOrg from 'tv-automation-quantel-gateway-client'
import {
	Expectation,
	ExpectationId,
	ExpectationManagerId,
	ExpectedPackageId,
	PackageContainerId,
	literal,
	protectString,
} from '@sofie-package-manager/api'
import type * as fsMockType from '../__mocks__/fs'
import type * as WNDType from '../__mocks__/windows-network-drive'
import type * as QGatewayClientType from '../__mocks__/tv-automation-quantel-gateway-client'
import { prepareTestEnvironment, TestEnvironment } from './lib/setupEnv'
import { describeForAllPlatforms, waitUntil } from './lib/lib'
import {
	getCorePackageInfoTarget,
	getFileShareSource,
	getLocalSource,
	getLocalTarget,
	getQuantelSource,
	getQuantelTarget,
} from './lib/containers'
jest.mock('fs')
jest.mock('child_process')
jest.mock('windows-network-drive')
jest.mock('tv-automation-quantel-gateway-client')
jest.mock('@parcel/watcher')
jest.mock('proper-lockfile')

const fs = fsOrg as any as typeof fsMockType
const WND = WNDOrg as any as typeof WNDType
const QGatewayClient = QGatewayClientOrg as any as typeof QGatewayClientType

const fsStat = promisify(fs.stat)

const MANAGER0 = protectString<ExpectationManagerId>('manager0')
const EXP_copy0 = protectString<ExpectationId>('copy0')
const PACKAGE0 = protectString<ExpectedPackageId>('package0')

const SOURCE0 = protectString<PackageContainerId>('source0')
const SOURCE1 = protectString<PackageContainerId>('source1')
const TARGET0 = protectString<PackageContainerId>('target0')
const TARGET1 = protectString<PackageContainerId>('target1')

let env: TestEnvironment
describeForAllPlatforms(
	'Basic',
	() => {
		beforeAll(async () => {
			env = await prepareTestEnvironment(false) // set to true to enable debug-logging
			// Verify that the fs mock works:
			expect(fs.lstat).toBeTruthy()
			expect(fs.__mockReset).toBeTruthy()
		})
		afterAll(() => {
			env.terminate()
		})
		beforeEach(() => {
			fs.__mockReset()
			fs.__restoreCallbackInterceptor()
			env.reset()
			QGatewayClient.resetMock()
		})
	},
	(platform) => {
		test('Be able to copy local file', async () => {
			fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)
			fs.__mockSetDirectory('/targets/target0')

			env.expectationManager.updateExpectations({
				[EXP_copy0]: literal<Expectation.FileCopy>({
					id: EXP_copy0,
					priority: 0,
					managerId: MANAGER0,
					fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
					type: Expectation.Type.FILE_COPY,
					statusReport: {
						label: `Copy file0`,
						description: `Copy file0 because test`,
						displayRank: 0,
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
					workOptions: {
						requiredForPlayout: true,
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
			}, env.WAIT_JOB_TIME)

			expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')

			expect(await fsStat('/targets/target0/myFolder/file0Target.mp4')).toMatchObject({
				size: 1234,
			})
		})

		if (platform === 'win32') {
			test('Be able to copy Networked file to local', async () => {
				fs.__mockSetFile('\\\\networkShare/sources/source1/file0Source.mp4', 1234)
				fs.__mockSetDirectory('/targets/target1')

				env.expectationManager.updateExpectations({
					[EXP_copy0]: literal<Expectation.FileCopy>({
						id: EXP_copy0,
						priority: 0,
						managerId: MANAGER0,
						fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
						type: Expectation.Type.FILE_COPY,
						statusReport: {
							label: `Copy file0`,
							description: `Copy file0 because test`,
							displayRank: 0,
							sendReport: true,
						},
						startRequirement: {
							sources: [getFileShareSource(SOURCE1, 'file0Source.mp4')],
						},
						endRequirement: {
							targets: [getLocalTarget(TARGET1, 'subFolder0/file0Target.mp4')],
							content: {
								filePath: 'subFolder0/file0Target.mp4',
							},
							version: { type: Expectation.Version.Type.FILE_ON_DISK },
						},
						workOptions: {
							requiredForPlayout: true,
						},
					}),
				})

				// Wait for the job to complete:
				await waitUntil(() => {
					expect(env.containerStatuses[TARGET1]).toBeTruthy()
					expect(env.containerStatuses[TARGET1].packages[PACKAGE0]).toBeTruthy()
					expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.status).toEqual(
						ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
					)
				}, env.WAIT_JOB_TIME)

				expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')

				expect(await WND.list()).toEqual({
					X: {
						driveLetter: 'X',
						path: '\\\\networkShare\\sources\\source1\\',
						status: true,
						statusMessage: 'Mock',
					},
				})

				expect(await fsStat('/targets/target1/subFolder0/file0Target.mp4')).toMatchObject({
					size: 1234,
				})
			})
		}
		test('Be able to copy Quantel clips', async () => {
			const orgClip = QGatewayClient.searchClip((clip) => clip.ClipGUID === 'abc123')[0]

			env.expectationManager.updateExpectations({
				[EXP_copy0]: literal<Expectation.QuantelClipCopy>({
					id: EXP_copy0,
					priority: 0,
					managerId: MANAGER0,
					fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
					type: Expectation.Type.QUANTEL_CLIP_COPY,
					statusReport: {
						label: `Copy quantel clip0`,
						description: `Copy clip0 because test`,
						displayRank: 0,
						sendReport: true,
					},
					startRequirement: {
						sources: [getQuantelSource(SOURCE0)],
					},
					endRequirement: {
						targets: [getQuantelTarget(TARGET1, 1001)],
						content: {
							guid: 'abc123',
						},
						version: { type: Expectation.Version.Type.QUANTEL_CLIP },
					},
					workOptions: {
						requiredForPlayout: true,
					},
				}),
			})

			// Wait for the job to complete:
			await waitUntil(() => {
				expect(env.containerStatuses[TARGET1]).toBeTruthy()
				expect(env.containerStatuses[TARGET1].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				)
			}, env.WAIT_JOB_TIME)

			expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')

			const newClip = QGatewayClient.searchClip((clip) => clip.ClipGUID === 'abc123' && clip !== orgClip.clip)[0]
			expect(newClip).toBeTruthy()

			expect(newClip).toMatchObject({
				server: {
					ident: 1001,
				},
				clip: {
					ClipGUID: 'abc123',
					CloneId: orgClip.clip.ClipID,
				},
			})
		})
		test.skip('Be able to copy local file to http', async () => {
			// To be written
			expect(1).toEqual(1)
		})
		test.skip('Be able to handle 1000 expectations', async () => {
			// To be written
			expect(1).toEqual(1)
		})
		test.skip('Media file preview from local to file share', async () => {
			// To be written
			expect(1).toEqual(1)
		})
		test.skip('Media file preview from local to file share', async () => {
			// To be written
			expect(1).toEqual(1)
		})
		test('Be able to copy JSON Data from local file to Core', async () => {
			fs.__mockSetFile('/sources/source0/myData0.json', 1234)

			env.expectationManager.updateExpectations({
				[EXP_copy0]: literal<Expectation.JsonDataCopy>({
					id: EXP_copy0,
					priority: 0,
					managerId: MANAGER0,
					fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
					type: Expectation.Type.JSON_DATA_COPY,
					statusReport: {
						label: `Copy json data`,
						description: `test`,
						sendReport: false,
					},
					startRequirement: {
						sources: [
							getLocalSource(
								SOURCE0,
								'myData0.json'
							) as Expectation.SpecificPackageContainerOnPackage.JSONDataSource,
						],
					},
					endRequirement: {
						targets: [
							getCorePackageInfoTarget(
								TARGET1
							) as Expectation.SpecificPackageContainerOnPackage.JSONDataTarget,
						],
						content: {},
						version: { type: Expectation.Version.Type.JSON_DATA },
					},
					workOptions: {},
				}),
			})

			// Wait for the job to complete:
			await waitUntil(() => {
				expect(env.containerStatuses[TARGET1]).toBeTruthy()
				expect(env.containerStatuses[TARGET1].packages[PACKAGE0]).toBeTruthy()
				expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.status).toEqual(
					ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				)
			}, env.WAIT_JOB_TIME)

			expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')
		})

		test('Be able to copy 10 local files', async () => {
			const COUNT = 10

			const COPY_TIME = env.SCALE_UP_TIME

			fs.__setCallbackInterceptor((type, cb) => {
				if (type === 'copyFile') {
					// Slow down copies:
					setTimeout(cb, COPY_TIME)
				} else cb()
			})

			const workforceRequestResourcesForExpectation = jest.fn(env.workforce.requestResourcesForExpectation)
			env.workforce.requestResourcesForExpectation = workforceRequestResourcesForExpectation

			const expectations: Record<ExpectationId, Expectation.Any> = {}
			fs.__mockSetDirectory('/targets/target0')
			for (let i = 0; i < COUNT; i++) {
				fs.__mockSetFile(`/sources/source0/file${i}Source.mp4`, 1234)

				const EXP_copy = protectString<ExpectationId>(`copy${i}`)
				const PACKAGE = protectString<ExpectedPackageId>(`package${i}`)

				expectations[EXP_copy] = literal<Expectation.FileCopy>({
					id: EXP_copy,
					priority: 0,
					managerId: MANAGER0,
					fromPackages: [{ id: PACKAGE, expectedContentVersionHash: 'abcd1234' }],
					type: Expectation.Type.FILE_COPY,
					statusReport: {
						label: `Copy file${i}`,
						description: `Copy file${i} because test`,
						displayRank: 0,
						sendReport: true,
					},
					startRequirement: {
						sources: [getLocalSource(SOURCE0, `file${i}Source.mp4`)],
					},
					endRequirement: {
						targets: [getLocalTarget(TARGET0, `myFolder/file${i}Target.mp4`)],
						content: {
							filePath: `file${i}Target.mp4`,
						},
						version: { type: Expectation.Version.Type.FILE_ON_DISK },
					},
					workOptions: {
						requiredForPlayout: true,
					},
				})
			}

			env.expectationManager.updateExpectations(expectations)

			// Wait for the job to complete:
			await waitUntil(() => {
				expect(env.containerStatuses[TARGET0]).toBeTruthy()
			}, env.WAIT_JOB_TIME)

			await waitUntil(() => {
				const packageStatuses: any = {
					actual: {},
					expected: {},
				}
				for (const exp of Object.values(expectations)) {
					const PACKAGE = exp.fromPackages[0].id

					packageStatuses.actual[PACKAGE] =
						env.containerStatuses[TARGET0].packages[PACKAGE]?.packageStatus?.status
					packageStatuses.expected[PACKAGE] =
						ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
				}
				expect(packageStatuses.actual).toMatchObject(packageStatuses.expected)
			}, 1000 + env.WAIT_JOB_TIME * 2 + COPY_TIME * 10)

			// Expect there to be requests to scale up workers:
			expect(workforceRequestResourcesForExpectation.mock.calls.length).toBeGreaterThan(5)
			expect(workforceRequestResourcesForExpectation.mock.calls.length).toBeLessThan(12)
		}, 5000)
	}
)

export {} // Just to get rid of a "not a module" warning
