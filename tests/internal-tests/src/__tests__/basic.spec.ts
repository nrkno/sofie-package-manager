import fsOrg from 'fs'
import { promisify } from 'util'
import WNDOrg from 'windows-network-drive'
// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import * as QGatewayClientOrg from 'tv-automation-quantel-gateway-client'
import { Expectation, literal } from '@sofie-package-manager/api'
import type * as fsMockType from '../__mocks__/fs'
import type * as WNDType from '../__mocks__/windows-network-drive'
import type * as QGatewayClientType from '../__mocks__/tv-automation-quantel-gateway-client'
import { prepareTestEnviromnent, TestEnviromnent } from './lib/setupEnv'
import { waitUntil } from './lib/lib'
import {
	getFileShareSource,
	getLocalSource,
	getLocalTarget,
	getQuantelSource,
	getQuantelTarget,
} from './lib/containers'
jest.mock('fs')
jest.mock('mkdirp')
jest.mock('child_process')
jest.mock('windows-network-drive')
jest.mock('tv-automation-quantel-gateway-client')

const fs = fsOrg as any as typeof fsMockType
const WND = WNDOrg as any as typeof WNDType
const QGatewayClient = QGatewayClientOrg as any as typeof QGatewayClientType

const fsStat = promisify(fs.stat)

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
	test('Be able to copy local file', async () => {
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
					targets: [getLocalTarget('target0', 'myFolder/file0Target.mp4')],
					content: {
						filePath: 'file0Target.mp4',
					},
					version: { type: Expectation.Version.Type.FILE_ON_DISK },
				},
				workOptions: {},
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

		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')

		expect(await fsStat('/targets/target0/myFolder/file0Target.mp4')).toMatchObject({
			size: 1234,
		})
	})
	test('Be able to copy Networked file to local', async () => {
		fs.__mockSetFile('\\\\networkShare/sources/source1/file0Source.mp4', 1234)
		fs.__mockSetDirectory('/targets/target1')

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
				workOptions: {},
			}),
		})

		// Wait for the job to complete:
		await waitUntil(() => {
			expect(env.containerStatuses['target1']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_JOB_TIME)

		expect(env.expectationStatuses['copy0'].statusInfo.status).toEqual('fulfilled')

		expect(await WND.list()).toEqual({
			X: '\\\\networkShare\\sources\\source1\\',
		})

		expect(await fsStat('/targets/target1/subFolder0/file0Target.mp4')).toMatchObject({
			size: 1234,
		})
	})
	test('Be able to copy Quantel clips', async () => {
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
				workOptions: {},
			}),
		})

		// Wait for the job to complete:
		await waitUntil(() => {
			expect(env.containerStatuses['target1']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0']).toBeTruthy()
			expect(env.containerStatuses['target1'].packages['package0'].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, env.WAIT_JOB_TIME)

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
})

export {} // Just to get rid of a "not a module" warning
