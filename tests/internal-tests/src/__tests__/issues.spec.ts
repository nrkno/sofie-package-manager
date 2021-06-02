// import { promisify } from 'util'
import * as fsOrg from 'fs'
import type * as fsMock from '../__mocks__/fs'
import { prepareTestEnviromnent, TestEnviromnent } from './lib/setupEnv'
jest.mock('fs')
jest.mock('child_process')
jest.mock('windows-network-drive')

const fs = (fsOrg as any) as typeof fsMock

// const fsStat = promisify(fs.stat)

const WAIT_JOB_TIME = 1 // seconds

describe('Handle unhappy paths', () => {
	let env: TestEnviromnent

	beforeAll(async () => {
		env = await prepareTestEnviromnent(true)
	})
	afterAll(() => {
		env.terminate()
	})

	beforeEach(() => {
		fs.__mockReset()
		env.reset()
	})
	test.skip(
		'Wait for non-existing local file',
		async () => {
			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Wait for non-existing network-shared, file',
		async () => {
			// To be written

			// Handle Drive-letters: Issue when when files aren't found? (Johan knows)

			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Wait for growing file',
		async () => {
			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Wait for non-existing file',
		async () => {
			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Wait for read access on source',
		async () => {
			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Wait for write access on target',
		async () => {
			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Expectation changed',
		async () => {
			// Expectation is changed while waiting for a file
			// Expectation is changed while work-in-progress
			// Expectation is changed after fullfilled

			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Aborting a job',
		async () => {
			// Expectation is aborted while waiting for a file
			// Expectation is aborted while work-in-progress
			// Expectation is aborted after fullfilled

			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
	test.skip(
		'Restarting a job',
		async () => {
			// Expectation is restarted while waiting for a file
			// Expectation is restarted while work-in-progress
			// Expectation is restarted after fullfilled

			// To be written
			expect(1).toEqual(1)
		},
		WAIT_JOB_TIME * 1000 + 5000
	)
})

export {}
