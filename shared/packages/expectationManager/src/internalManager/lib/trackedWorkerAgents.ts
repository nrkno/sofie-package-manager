import { PromisePool } from '@supercharge/promise-pool'
import { LoggerInstance, Reason, stringifyError } from '@sofie-package-manager/api'
import { ExpectationStateHandlerSession, WorkerAgentAssignment } from '../../lib/types'
import { WorkerAgentAPI } from '../../workerAgentApi'
import { ExpectationTracker } from '../../expectationTracker/expectationTracker'
import { TrackedExpectation } from '../../lib/trackedExpectation'

/** Storage for WorkerAgents */
export class TrackedWorkerAgents {
	private workerAgents: {
		[workerId: string]: TrackedWorkerAgent
	} = {}

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('TrackedWorkerAgents')
	}

	public get(workerId: string): TrackedWorkerAgent | undefined {
		return this.workerAgents[workerId]
	}
	public list(): { workerId: string; workerAgent: TrackedWorkerAgent }[] {
		return Object.entries(this.workerAgents).map(([workerId, workerAgent]) => {
			return {
				workerId,
				workerAgent,
			}
		})
	}
	public upsert(workerId: string, workerAgent: TrackedWorkerAgent): void {
		this.workerAgents[workerId] = workerAgent
	}
	public remove(workerId: string): void {
		delete this.workerAgents[workerId]
	}

	/**
	 * Asks the Workers if they support a certain Expectation.
	 * Updates trackedExp.availableWorkers to reflect the result.
	 */
	public async updateAvailableWorkersForExpectation(trackedExp: TrackedExpectation): Promise<{
		hasQueriedAnyone: boolean
		workerCount: number
	}> {
		const workerAgents = this.list()

		// Note: In the future, this algorithm could be change to not ask ALL
		// workers, but instead just ask until we have got an enough number of available workers.

		let hasQueriedAnyone = false
		await Promise.all(
			workerAgents.map(async ({ workerId, workerAgent }) => {
				if (!workerAgent.connected) return

				// Only ask each worker once, or after a certain time has passed:
				if (
					!trackedExp.queriedWorkers[workerId] ||
					Date.now() - trackedExp.queriedWorkers[workerId] > this.tracker.constants.WORKER_SUPPORT_TIME
				) {
					trackedExp.queriedWorkers[workerId] = Date.now()
					hasQueriedAnyone = true
					try {
						const support = await workerAgent.api.doYouSupportExpectation(trackedExp.exp)

						if (support.support) {
							trackedExp.availableWorkers[workerId] = true
						} else {
							delete trackedExp.availableWorkers[workerId]
							trackedExp.noAvailableWorkersReason = support.reason
						}
					} catch (err) {
						delete trackedExp.availableWorkers[workerId]

						if ((err + '').match(/timeout/i)) {
							trackedExp.noAvailableWorkersReason = {
								user: 'Worker timed out',
								tech: `Worker "${workerId} timeout"`,
							}
						} else throw err
					}
				}
			})
		)

		return {
			hasQueriedAnyone,
			workerCount: workerAgents.length,
		}
	}

	/**
	 * Goes through a list of workers and determine which of them is the "cheapest" one to handle a certain Expectation.
	 * @returns the best worker (and some metadata)
	 */
	public async determineBestWorkerForExpectation(trackedExp: TrackedExpectation): Promise<{
		bestWorker: WorkerAgentAssignment | undefined
		countQueried: number
		countInfinite: number
		noCostReason: Reason
	}> {
		/** How many requests to send out simultaneously */
		const BATCH_SIZE = 10
		/** How many answers we want to have before continuing with picking one */
		const minWorkerCount = 5

		let countQueried = 0
		let countInfinite = 0

		const workerIds = Object.keys(trackedExp.availableWorkers)

		let noCostReason: Reason = {
			user: `${workerIds.length} workers are currently busy`,
			tech: `${workerIds.length} busy, ${Object.keys(trackedExp.queriedWorkers).length} queried`,
		}

		const workerCosts: WorkerAgentAssignment[] = []

		// We're using PromisePool to query a batch of workers at a time:
		await PromisePool.for(workerIds)
			.withConcurrency(BATCH_SIZE)
			.handleError(async (error, workerId: string) => {
				// Log the error
				this.logger.error(`Error in assignWorkerToSession for worker "${workerId}": ${stringifyError(error)}`)
			})
			.process(async (workerId: string) => {
				// Abort if we have gotten enough answers:
				if (workerCosts.length >= minWorkerCount) return

				const workerAgent = this.get(workerId)
				if (workerAgent) {
					try {
						countQueried++
						const cost = await workerAgent.api.getCostForExpectation(trackedExp.exp)

						if (cost.cost < Number.POSITIVE_INFINITY) {
							workerCosts.push({
								worker: workerAgent.api,
								id: workerId,
								cost,
								randomCost: Math.random(), // To randomize if there are several with the same best cost
							})
						} else {
							noCostReason = cost.reason
							countInfinite++
						}
					} catch (error) {
						noCostReason = {
							user: 'Error: Internal Error',
							tech: `${stringifyError(error, true)}`,
						}
					}
				}
			})

		workerCosts.sort((a, b) => {
			// Lowest cost first:
			const aCost: number = a.cost.startCost + a.cost.cost
			const bCost: number = b.cost.startCost + b.cost.cost
			if (aCost > bCost) return 1
			if (aCost < bCost) return -1

			// To randomize if there are several with the same best cost:
			if (a.randomCost > b.randomCost) return 1
			if (a.randomCost < b.randomCost) return -1

			return 0
		})

		return {
			bestWorker: workerCosts[0],
			countQueried,
			countInfinite,
			noCostReason,
		}
	}

	/** Do a bidding between the available Workers and assign the cheapest one to use for the evaulation-session. */
	public async assignWorkerToSession(trackedExp: TrackedExpectation): Promise<void> {
		const session: ExpectationStateHandlerSession | null = trackedExp.session
		if (!session) throw new Error('ExpectationManager: Internal error: Session not set')
		if (session.assignedWorker) return // A worker has already been assigned

		if (!Object.keys(trackedExp.availableWorkers).length) {
			session.noAssignedWorkerReason = { user: `No workers available`, tech: `No workers available` }
		}

		// Send a number of requests simultaneously:

		const { bestWorker, countQueried, countInfinite, noCostReason } = await this.determineBestWorkerForExpectation(
			trackedExp
		)

		if (bestWorker) {
			session.assignedWorker = bestWorker
			trackedExp.noWorkerAssignedTime = null
		} else {
			session.noAssignedWorkerReason = {
				user: `Waiting for a free worker, ${noCostReason.user}`,
				tech: `Waiting for a free worker ${noCostReason.tech} (${
					Object.keys(trackedExp.availableWorkers).length
				} busy, ${countQueried} asked, ${countInfinite} infinite cost)`,
			}
		}
	}
}

export interface TrackedWorkerAgent {
	api: WorkerAgentAPI
	connected: boolean
}
