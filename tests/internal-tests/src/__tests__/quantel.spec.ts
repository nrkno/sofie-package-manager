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
	waitTime,
} from '@sofie-package-manager/api'
import type * as QGatewayClientType from '../__mocks__/tv-automation-quantel-gateway-client'
import { prepareTestEnviromnent, TestEnviromnent } from './lib/setupEnv'
import { waitUntil } from './lib/lib'
import { getQuantelSource, getQuantelTarget } from './lib/containers'
jest.mock('child_process')
jest.mock('tv-automation-quantel-gateway-client')

const QGatewayClient = QGatewayClientOrg as any as typeof QGatewayClientType

describe('Quantel', () => {
	let env: TestEnviromnent

	beforeAll(async () => {
		env = await prepareTestEnviromnent(false) // set to true to enable debug-logging
	})
	afterAll(() => {
		env.terminate()
	})
	beforeEach(() => {
		env.reset()
		QGatewayClient.resetMock()
	})
	const EXP_copy0 = protectString<ExpectationId>('copy0')
	const MANAGER0 = protectString<ExpectationManagerId>('manager0')
	const PACKAGE0 = protectString<ExpectedPackageId>('package0')

	const SOURCE0 = protectString<PackageContainerId>('source0')
	const TARGET1 = protectString<PackageContainerId>('target1')

	test('Clone by guid', async () => {
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
					requiredForPlayout: true,
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
	test('Clone by title', async () => {
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
					requiredForPlayout: true,
					displayRank: 0,
					sendReport: true,
				},
				startRequirement: {
					sources: [getQuantelSource(SOURCE0)],
				},
				endRequirement: {
					targets: [getQuantelTarget(TARGET1, 1001)],
					content: {
						title: 'elephants',
					},
					version: { type: Expectation.Version.Type.QUANTEL_CLIP },
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
	test('Edge case: A clip has changed title', async () => {
		/*
        This is an edge case where the title is changed for a clip on the ISA,
        after it has been copied to the server.
        */

		// Set up the clips on the servers:
		const mock = QGatewayClient.getMock()
		expect(mock.servers).toHaveLength(2)

		expect(mock.servers[0].pools).toHaveLength(1)
		expect(mock.servers[1].pools).toHaveLength(1)

		// Source server:
		mock.servers[0].pools[0].clips = [
			{
				ClipID: 10,
				ClipGUID: 'abc123',
				Title: 'New elephants', // The title was changed after the clip was cloned
				CloneId: null,
				Completed: '2020-01-01',
				Frames: '1337',
			},
		]
		// Target server:
		mock.servers[1].pools[0].clips = [
			{
				ClipID: 11,
				CloneId: 10, // the clip was cloned from 10
				ClipGUID: 'abc123',
				Title: 'OG elephants', // original title
				Completed: '2020-01-01',
				Frames: '1337',
			},
		]

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
					requiredForPlayout: true,
					displayRank: 0,
					sendReport: true,
				},
				startRequirement: {
					sources: [getQuantelSource(SOURCE0)],
				},
				endRequirement: {
					targets: [getQuantelTarget(TARGET1, 1001)],
					content: {
						title: 'New elephants',
					},
					version: { type: Expectation.Version.Type.QUANTEL_CLIP },
				},
				workOptions: {},
			}),
		})

		// Wait a little while, to ensure that an evaulation has passed:
		await waitTime(env.WAIT_JOB_TIME)

		expect(QGatewayClient.QuantelGatewayInstances.length).toBeGreaterThanOrEqual(1)
		for (const instance of QGatewayClient.QuantelGatewayInstances) {
			// No actual copying should have been done, since the clip was actually already there (only with the wrong title):
			expect(instance.mockCopyCount).toBe(0)
		}

		expect(env.containerStatuses[TARGET1]).toBeTruthy()
		expect(env.containerStatuses[TARGET1].packages[PACKAGE0]).toBeTruthy()
		expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.status).toEqual(
			ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
		)

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
	test('Reserved clip', async () => {
		// const orgClip = QGatewayClient.searchClip((clip) => clip.ClipGUID === 'abc123-reserved-clip')[0]

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
					requiredForPlayout: true,
					displayRank: 0,
					sendReport: true,
				},
				startRequirement: {
					sources: [getQuantelSource(SOURCE0)],
				},
				endRequirement: {
					targets: [getQuantelTarget(TARGET1, 1001)],
					content: {
						guid: 'abc123-reserved-clip',
					},
					version: { type: Expectation.Version.Type.QUANTEL_CLIP },
				},
				workOptions: {},
			}),
		})

		// Wait for the job to get the correct status:
		await waitUntil(() => {
			expect(env.containerStatuses[TARGET1]).toBeTruthy()
			expect(env.containerStatuses[TARGET1].packages[PACKAGE0]).toBeTruthy()
			expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.statusReason.user).toEqual(
				`Reserved clip, not yet ready for playout`
			)
			expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.PLACEHOLDER
			)
		}, env.WAIT_JOB_TIME)

		// Now, set the clip to have frames:
		QGatewayClient.updateClip((clip) => {
			if (clip.ClipGUID === 'abc123-reserved-clip') {
				return {
					...clip,
					Frames: '1234',
				}
			}
			return undefined
		})

		// Wait for the job to finish:
		await waitUntil(() => {
			expect(env.containerStatuses[TARGET1]).toBeTruthy()
			expect(env.containerStatuses[TARGET1].packages[PACKAGE0]).toBeTruthy()
			// expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.statusReason.user).toEqual('')
			expect(env.containerStatuses[TARGET1].packages[PACKAGE0].packageStatus?.status).toEqual(
				ExpectedPackageStatusAPI.PackageContainerPackageStatusStatus.READY
			)
		}, 500 + env.WAIT_JOB_TIME)

		expect(env.expectationStatuses[EXP_copy0].statusInfo.status).toEqual('fulfilled')
	})
})

export {} // Just to get rid of a "not a module" warning
