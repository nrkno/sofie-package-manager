import { Expectation } from '@sofie-package-manager/api'
import { getDefaultConstants } from '../lib/constants'
import { getDefaultTrackedExpectation, sortTrackedExpectations } from '../lib/expectations'
import { TrackedExpectation } from '../expectationTracker'

test('sortExpectations', () => {
	// ensure that sort order is correct

	const exp: Expectation.FileCopy = {
		id: 'N/A',
		type: Expectation.Type.FILE_COPY,
		managerId: '',
		priority: 0,
		fromPackages: [],
		statusReport: {
			sendReport: false,
			label: '',
			description: '',
		},
		startRequirement: {
			sources: [],
		},
		endRequirement: {
			targets: [],
			content: {
				filePath: '',
			},
			version: {
				type: Expectation.Version.Type.FILE_ON_DISK,
			},
		},
		workOptions: {},
	}

	const now = Date.now()

	const tracked: TrackedExpectation[] = [
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'highest-priority',
				priority: 1,
			}),
			lastEvaluationTime: now - 10 * 1000, // 10 second ago
		},
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'highest-priority-recently-evaluated',
				priority: 1,
			}),
			lastEvaluationTime: now - 1000, // 1 second ago
		},
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'highest-priority-never-evaluated',
				priority: 1,
			}),
		},
		getDefaultTrackedExpectation({
			...exp,
			id: 'high-priority',
			priority: 10,
		}),
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'high-prio-with-error',
				priority: 10,
			}),
			lastError: {
				time: now - 5 * 1000, // 5 seconds ago
				reason: { user: 'user', tech: 'tech' },
			},
		},
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'high-prio-with-old-error',
				priority: 10,
			}),
			lastError: {
				time: now - 10 * 60 * 1000, // 10 minutes ago
				reason: { user: 'user', tech: 'tech' },
			},
		},
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'high-prio-with-older-error',
				priority: 10,
			}),
			lastError: {
				time: now - 11 * 60 * 1000, // 11 minutes ago
				reason: { user: 'user', tech: 'tech' },
			},
		},
		getDefaultTrackedExpectation({
			...exp,
			id: 'medium-priority',
			priority: 50,
		}),
		getDefaultTrackedExpectation({
			...exp,
			id: 'low-priority',
			priority: 100,
		}),
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'low-prio-with-error',
				priority: 100,
			}),
			lastError: {
				time: now - 8 * 1000, // 8 seconds ago
				reason: { user: 'user', tech: 'tech' },
			},
		},
		{
			...getDefaultTrackedExpectation({
				...exp,
				id: 'low-prio-with-most-recent-error',
				priority: 100,
			}),
			lastError: {
				time: now - 2 * 1000, // 2 seconds ago
				reason: { user: 'user', tech: 'tech' },
			},
		},
		getDefaultTrackedExpectation({
			...exp,
			id: 'lowest-priority',
			priority: 999,
		}),
	]

	const trackedExpectations: { [id: string]: TrackedExpectation } = {}
	tracked.forEach((tracked) => {
		trackedExpectations[tracked.id] = tracked
	})

	const sorted = sortTrackedExpectations(trackedExpectations, getDefaultConstants())

	const sortedIds = sorted.map((tracked) => tracked.id)

	expect(sortedIds).toEqual([
		// No errors, or old errors:
		'highest-priority-never-evaluated',
		'highest-priority',
		'highest-priority-recently-evaluated',

		'high-priority',
		'high-prio-with-older-error',
		'high-prio-with-old-error',

		'medium-priority',

		'low-priority',
		'lowest-priority',

		// Recent errors:
		'high-prio-with-error',
		'low-prio-with-error',
		'low-prio-with-most-recent-error',
	])
})
