import { ExpectedPackageStatusAPI } from '@sofie-automation/blueprints-integration'
import * as QGatewayClientOrg from 'tv-automation-quantel-gateway-client'
import { Expectation, literal } from '@shared/api'
import type * as QGatewayClientType from '../__mocks__/tv-automation-quantel-gateway-client'
import { prepareTestEnviromnent, TestEnviromnent } from './lib/setupEnv'
import { waitTime } from './lib/lib'
import { getQuantelSource, getQuantelTarget } from './lib/containers'
jest.mock('child_process')
jest.mock('tv-automation-quantel-gateway-client')

const QGatewayClient = (QGatewayClientOrg as any) as typeof QGatewayClientType

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
	test('Clone by guid', async () => {
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

		await waitTime(env.WAIT_JOB_TIME)

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
	})
	test('Clone by title', async () => {
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
						title: 'elephants',
					},
					version: { type: Expectation.Version.Type.QUANTEL_CLIP },
				},
				workOptions: {},
			}),
		})

		await waitTime(env.WAIT_JOB_TIME)

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
						title: 'New elephants',
					},
					version: { type: Expectation.Version.Type.QUANTEL_CLIP },
				},
				workOptions: {},
			}),
		})

		await waitTime(env.WAIT_JOB_TIME)

		// Expect the job to have completed by now:

		expect(QGatewayClient.QuantelGatewayInstances.length).toBeGreaterThanOrEqual(1)
		for (const instance of QGatewayClient.QuantelGatewayInstances) {
			// No actual copying should have been done, since the clip was actually already there (only with the wrong title):
			expect(instance.mockCopyCount).toBe(0)
		}

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
	})
})

export {} // Just to get rid of a "not a module" warning
