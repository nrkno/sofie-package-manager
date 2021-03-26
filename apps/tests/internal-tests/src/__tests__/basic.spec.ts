import { promisify } from 'util'
import { Expectation, literal } from '@shared/api'
import * as fsOrg from 'fs'
import type * as fsMockType from '../__mocks__/fs'
import * as WNDOrg from 'windows-network-drive'
import type * as WNDType from '../__mocks__/windows-network-drive'
import * as QGatewayClientOrg from 'tv-automation-quantel-gateway-client'
import type * as QGatewayClientType from '../__mocks__/tv-automation-quantel-gateway-client'
import { prepareTestEnviromnent, TestEnviromnent } from './lib/setupEnv'
import { waitSeconds } from './lib/lib'
import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import {
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

const fs = (fsOrg as any) as typeof fsMockType
const WND = (WNDOrg as any) as typeof WNDType
const QGatewayClient = (QGatewayClientOrg as any) as typeof QGatewayClientType

const fsStat = promisify(fs.stat)

const WAIT_JOB_TIME = 1 // seconds

describe('Basic', () => {
	let env: TestEnviromnent

	beforeAll(async () => {
		env = await prepareTestEnviromnent(false) // set to true to enable debug-logging
		// Verify that the fs mock works:
		expect(fs.lstat).toBeTruthy()
		expect(fs.__mockReset).toBeTruthy()
	})
	afterAll(() => {
		env.terminate()
	})
	beforeEach(() => {
		fs.__mockReset()
		env.reset()
		QGatewayClient.resetMock()
	})
	test(
		'Be able to copy local file',
		async () => {
			fs.__mockSetFile('/sources/source0/file0Source.mp4', 1234)
			fs.__mockSetDirectory('/targets/target0')
			// console.log(fs.__printAllFiles())

			env.expectationManager.updateExpectations({
				copy0: literal<Expectation.FileCopy>({
					id: 'copy0',
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
						sources: [getLocalSource('source0', 'file0Source.mp4')],
					},
					endRequirement: {
						targets: [getLocalTarget('target0', 'file0Target.mp4')],
						content: {
							filePath: 'file0Target.mp4',
						},
						version: { type: Expectation.Version.Type.FILE_ON_DISK },
					},
				}),
			})

			await waitSeconds(WAIT_JOB_TIME)

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
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test(
		'Be able to copy Networked file to local',
		async () => {
			fs.__mockSetFile('\\\\networkShare/sources/source1/file0Source.mp4', 1234)
			fs.__mockSetDirectory('/targets/target1')
			// console.log(fs.__printAllFiles())

			env.expectationManager.updateExpectations({
				copy0: literal<Expectation.FileCopy>({
					id: 'copy0',
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
						sources: [getFileShareSource('source1', 'file0Source.mp4')],
					},
					endRequirement: {
						targets: [getLocalTarget('target1', 'subFolder0/file0Target.mp4')],
						content: {
							filePath: 'subFolder0/file0Target.mp4',
						},
						version: { type: Expectation.Version.Type.FILE_ON_DISK },
					},
				}),
			})

			await waitSeconds(WAIT_JOB_TIME)

			// Expect the copy to have completed by now:

			// console.log(fs.__printAllFiles())

			expect(env.containerStatuses['target1']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)

			expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')

			expect(await WND.list()).toEqual({
				X: '\\\\networkShare\\sources\\source1\\',
			})

			expect(await fsStat('/targets/target1/subFolder0/file0Target.mp4')).toMatchObject({
				size: 1234,
			})
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test(
		'Be able to copy Quantel clips',
		async () => {
			const orgClip = QGatewayClient.searchClip((clip) => clip.ClipGUID === 'abc123')[0]

			env.expectationManager.updateExpectations({
				copy0: literal<Expectation.QuantelClipCopy>({
					id: 'copy0',
					priority: 0,
					managerId: 'manager0',
					fromPackages: [{ id: 'package0', expectedContentVersionHash: 'abcd1234' }],
					type: Expectation.Type.QUANTEL_CLIP_COPY,
					statusReport: {
						label: `Copy quantel clip0`,
						description: `Copy clip0 because test`,
						requiredForPlayout: true,
						displayRank: 0,
						sendReport: true,
					},
					startRequirement: {
						sources: [getQuantelSource('source0')],
					},
					endRequirement: {
						targets: [getQuantelTarget('target1', 1001)],
						content: {
							guid: 'abc123',
						},
						version: { type: Expectation.Version.Type.QUANTEL_CLIP },
					},
				}),
			})

			await waitSeconds(WAIT_JOB_TIME)

			// Expect the copy to have completed by now:

			expect(env.containerStatuses['target1']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)

			expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')

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
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Be able to copy local file to http',
		async () => {
			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Be able to handle 1000 expectations',
		async () => {
			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
})

export {}
