import { PromisePool } from '@supercharge/promise-pool'
import { LoggerInstance, Reason, WorkerAgentId, valueOfCost, stringifyError } from '@sofie-package-manager/api'
import { ExpectationStateHandlerSession, WorkerAgentAssignment } from '../../lib/types'
import { WorkerAgentAPI } from '../../workerAgentApi'
import { ExpectationTracker } from '../../expectationTracker/expectationTracker'
import { TrackedExpectation } from '../../lib/trackedExpectation'

/** Storage for WorkerAgents */
export class TrackedWorkerAgents {
	private workerAgents: Map<WorkerAgentId, TrackedWorkerAgent> = new Map()

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('TrackedWorkerAgents')
	}

	public get(workerId: WorkerAgentId): TrackedWorkerAgent | undefined {
		return this.workerAgents.get(workerId)
	}
	public list(): { workerId: WorkerAgentId; workerAgent: TrackedWorkerAgent }[] {
		return Array.from(this.workerAgents.entries()).map(([workerId, workerAgent]) => {
			return {
				workerId,
				workerAgent,
			}
		})
	}
	public upsert(workerId: WorkerAgentId, workerAgent: TrackedWorkerAgent): void {
		this.workerAgents.set(workerId, workerAgent)
	}
	public remove(workerId: WorkerAgentId): void {
		this.workerAgents.delete(workerId)
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
				const queriedWorker = trackedExp.queriedWorkers.get(workerId)
				if (!queriedWorker || Date.now() - queriedWorker > this.tracker.constants.WORKER_SUPPORT_TIME) {
					trackedExp.queriedWorkers.set(workerId, Date.now())
					hasQueriedAnyone = true
					try {
						const support = await workerAgent.api.doYouSupportExpectation(trackedExp.exp)

						if (support.support) {
							trackedExp.availableWorkers.add(workerId)
						} else {
							trackedExp.availableWorkers.delete(workerId)
							trackedExp.noAvailableWorkersReason = support.reason
						}
					} catch (err) {
						trackedExp.availableWorkers.delete(workerId)

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
		noCostReason: Reason
	}> {
		/** How many requests to send out simultaneously */
		const BATCH_SIZE = 10
		/** How many answers we want to have before continuing with picking one */
		const minWorkerCount = 5

		let countQueried = 0
		let countInfinite = 0

		const workerIds = Array.from(trackedExp.availableWorkers.keys())

		let noCostReason: Reason | undefined = undefined

		const workerCosts: WorkerAgentAssignment[] = []

		// We're using PromisePool to query a batch of workers at a time:
		await PromisePool.for(workerIds)
			.withConcurrency(BATCH_SIZE)
			.handleError(async (error, workerId: WorkerAgentId) => {
				// Log the error
				this.logger.error(`Error in assignWorkerToSession for worker "${workerId}": ${stringifyError(error)}`)
			})
			.process(async (workerId: WorkerAgentId) => {
				// Abort if we have gotten enough answers:
				if (workerCosts.length >= minWorkerCount) return

				const workerAgent = this.get(workerId)
				if (workerAgent) {
					try {
						countQueried++
						const cost = await workerAgent.api.getCostForExpectation(trackedExp.exp)

						if (cost.cost !== null) {
							// null means that the cost is "infinite"
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
				} else {
					this.logger.error(`Worker "${workerId}" not found in determineBestWorkerForExpectation`)
				}
			})

		workerCosts.sort((a, b) => {
			// Lowest cost first:
			const aCost: number = valueOfCost(a.cost.startCost) + valueOfCost(a.cost.cost)
			const bCost: number = valueOfCost(b.cost.startCost) + valueOfCost(b.cost.cost)
			if (aCost > bCost) return 1
			if (aCost < bCost) return -1

			// To randomize if there are several with the same best cost:
			if (a.randomCost > b.randomCost) return 1
			if (a.randomCost < b.randomCost) return -1

			return 0
		})

		if (!noCostReason) {
			noCostReason = {
				user: `${countInfinite} workers are currently busy`,
				tech:
					`availableWorkers: ${trackedExp.availableWorkers.size}, ` +
					`queriedWorkers: ${trackedExp.queriedWorkers.size}, ` +
					`countQueried: ${countQueried}, ` +
					`countInfinite: ${countInfinite} ` +
					`(Worker costs: ${workerCosts.map((c) => `${c.id}: ${c.cost}`).join(', ')}`,
			}
		}

		return {
			bestWorker: workerCosts[0],
			noCostReason,
		}
	}

	/** Do a bidding between the available Workers and assign the cheapest one to use for the evaulation-session. */
	public async assignWorkerToSession(trackedExp: TrackedExpectation): Promise<void> {
		const session: ExpectationStateHandlerSession | null = trackedExp.session
		if (!session) throw new Error('ExpectationManager: Internal error: Session not set')
		if (session.assignedWorker) {
			// A worker has already been assigned
			trackedExp.noWorkerAssignedTime = null
			return
		}

		// Remove any workers that no longer exist:
		// (Like if a worker has shut down)
		{
			for (const workerId of trackedExp.availableWorkers.keys()) {
				if (!this.get(workerId)) {
					trackedExp.availableWorkers.delete(workerId)
				}
			}
			for (const workerId of trackedExp.queriedWorkers.keys()) {
				if (!this.get(workerId)) {
					trackedExp.queriedWorkers.delete(workerId)
				}
			}
		}

		if (trackedExp.waitingForWorkerTime !== null) {
			// If the expectation is waiting for a worker, it might be a good idea to update the list of available workers:
			// (This can be useful for example if a new worker has just been registered)
			await this.updateAvailableWorkersForExpectation(trackedExp)
		}

		if (!trackedExp.availableWorkers.size) {
			session.noAssignedWorkerReason = { user: `No workers available`, tech: `No workers available` }
		}

		// Send a number of requests simultaneously:

		const { bestWorker, noCostReason } = await this.determineBestWorkerForExpectation(trackedExp)

		if (bestWorker) {
			session.assignedWorker = bestWorker
			trackedExp.noWorkerAssignedTime = null
		} else {
			session.noAssignedWorkerReason = {
				user: `Waiting for a free worker, ${noCostReason.user}`,
				tech: `Waiting for a free worker, ${noCostReason.tech}`,
			}
		}
	}
}

export interface TrackedWorkerAgent {
	api: WorkerAgentAPI
	connected: boolean
}
