import { PartialDeep } from 'type-fest'
import {
	ExpectationId,
	LogLevel,
	ProcessConfig,
	WorkerAgentId,
	initializeLogger,
	literal,
	protectString,
	setupLogger,
} from '@sofie-package-manager/api'
import { WorkerScaler } from '../workerScaler'
import { InternalManager } from '../../../internalManager/internalManager'
import { TrackedWorkerAgent } from '../../../internalManager/lib/trackedWorkerAgents'
import { ExpectationTracker } from '../../expectationTracker'
import { TrackedExpectation } from '../../../lib/trackedExpectation'
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'

// ---------------------------------------------------------
const SCALE_UP_COUNT = 1
const SCALE_UP_TIME = 10
let isThereExistingWorkers = false
// ---------------------------------------------------------

const logLevel = LogLevel.WARN
const config = {
	process: literal<ProcessConfig>({
		logPath: undefined,
		logLevel: undefined,
		unsafeSSL: false,
		certificates: [],
	}),
}
initializeLogger(config)
const logger = setupLogger(config, '', undefined, undefined, logLevel)
logger.warn = jest.fn(logger.warn) as any
logger.error = jest.fn(logger.error) as any

const requestResourcesForExpectation = jest.fn(async () => false)

const fakeManager = literal<PartialDeep<InternalManager>>({
	workforceConnection: {
		workforceAPI: {
			requestResourcesForExpectation,
		},
	},
	workerAgents: {
		list: (): { workerId: WorkerAgentId; workerAgent: TrackedWorkerAgent }[] => {
			if (isThereExistingWorkers)
				return [
					{
						workerId: protectString('worker0'),
						workerAgent: {} as any as TrackedWorkerAgent,
					},
				]
			else return []
		},
	},
}) as any as InternalManager

const fakeTracker = literal<PartialDeep<ExpectationTracker>>({
	constants: {
		SCALE_UP_COUNT,
		SCALE_UP_TIME,
	},
	trackedExpectations: {
		list: (): TrackedExpectation[] => {
			return expectations
		},
	},
	trackedExpectationAPI: {
		isExpectationWaitingForOther: (_exp): TrackedExpectation | null => {
			return null
		},
	},
	getTrackedPackageContainers: () => {
		return []
	},
}) as any as ExpectationTracker
let expectations: TrackedExpectation[] = []
function setExpectations(
	from: {
		id: string
		state: ExpectedPackageStatusAPI.WorkStatusState
		hasAvailableWorkers: boolean
		noWorkerAssignedTime?: number
	}[]
) {
	expectations = Array.from(from).map((e): TrackedExpectation => {
		return literal<PartialDeep<TrackedExpectation>>({
			id: protectString<ExpectationId>(e.id),
			state: e.state,
			noWorkerAssignedTime: e.noWorkerAssignedTime ?? null,
			availableWorkers: new Set<WorkerAgentId>(e.hasAvailableWorkers ? [protectString('worker0')] : []),

			exp: {
				statusReport: {
					label: `mock${e.id}`,
				},
			},
		}) as any as TrackedExpectation
	})
}

beforeEach(() => {
	isThereExistingWorkers = false
	expectations = []

	requestResourcesForExpectation.mockClear()
})
afterEach(() => {
	expect(logger.warn).toHaveBeenCalledTimes(0)
	expect(logger.error).toHaveBeenCalledTimes(0)
})

test('no expectations', async () => {
	const scaler = new WorkerScaler(logger, fakeManager, fakeTracker)
	await scaler.checkIfNeedToScaleUp()

	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(0)
})
test('1 fulfilled expectation', async () => {
	const scaler = new WorkerScaler(logger, fakeManager, fakeTracker)

	isThereExistingWorkers = false
	setExpectations([
		{
			id: 'exp0',
			state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
			hasAvailableWorkers: true,
		},
	])

	await scaler.checkIfNeedToScaleUp()
	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(0)
})

test('1 waiting expectation, no workers', async () => {
	const scaler = new WorkerScaler(logger, fakeManager, fakeTracker)

	isThereExistingWorkers = false
	setExpectations([
		{
			id: 'exp0',
			state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
			hasAvailableWorkers: false,
		},
	])

	await scaler.checkIfNeedToScaleUp()
	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(1)
})

test('1 waiting expectation', async () => {
	const scaler = new WorkerScaler(logger, fakeManager, fakeTracker)

	isThereExistingWorkers = true
	setExpectations([
		{
			id: 'exp0',
			state: ExpectedPackageStatusAPI.WorkStatusState.WAITING,
			hasAvailableWorkers: true,
		},
	])

	await scaler.checkIfNeedToScaleUp()
	await sleep(SCALE_UP_TIME * 2)
	await scaler.checkIfNeedToScaleUp()
	// No need to scale up, as there are already workers available
	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(0)
})
test('1 fulfilled expectation, not assigned to worker', async () => {
	const scaler = new WorkerScaler(logger, fakeManager, fakeTracker)

	isThereExistingWorkers = true
	setExpectations([
		{
			id: 'exp0',
			state: ExpectedPackageStatusAPI.WorkStatusState.FULFILLED,
			noWorkerAssignedTime: Date.now() - 1000,
			hasAvailableWorkers: true,
		},
	])

	await scaler.checkIfNeedToScaleUp()
	await sleep(SCALE_UP_TIME * 2)
	await scaler.checkIfNeedToScaleUp()
	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(1)
})
test('1 new expectation, no available workers', async () => {
	const scaler = new WorkerScaler(logger, fakeManager, fakeTracker)

	isThereExistingWorkers = true
	setExpectations([
		{
			id: 'exp0',
			state: ExpectedPackageStatusAPI.WorkStatusState.NEW,
			// noWorkerAssignedTime: Date.now() - 1000,
			hasAvailableWorkers: false,
		},
	])

	await scaler.checkIfNeedToScaleUp()
	await sleep(SCALE_UP_TIME * 2)
	await scaler.checkIfNeedToScaleUp()
	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(1)
})
test('1 ready expectation', async () => {
	const scaler = new WorkerScaler(logger, fakeManager, fakeTracker)

	isThereExistingWorkers = true
	setExpectations([
		{
			id: 'exp0',
			state: ExpectedPackageStatusAPI.WorkStatusState.READY,
			hasAvailableWorkers: true,
		},
	])

	await scaler.checkIfNeedToScaleUp()
	// Should not scale up right away:
	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(0)

	await sleep(SCALE_UP_TIME * 2)
	await scaler.checkIfNeedToScaleUp()
	// Should scale up, since the READY expectation is waiting for a worker to start working on it:
	expect(fakeManager.workforceConnection.workforceAPI.requestResourcesForExpectation).toHaveBeenCalledTimes(1)
})

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
