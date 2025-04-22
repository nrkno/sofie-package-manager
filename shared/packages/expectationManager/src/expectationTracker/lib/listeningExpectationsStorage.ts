import { ExpectationId, LoggerInstance } from '@sofie-package-manager/api'
import { ExpectationTracker } from '../expectationTracker'

/** Keeps track of which Expectations are waiting for the fulfillment of other Expectations */
export class ListeningExpectationsStorage {
	/**
	 * key-value store of which expectations are triggered when another is fulfilled.
	 * The value is a list of the expectations that listen to the fulfillment
	 * The key is the id of the expectation they are listening to
	 */
	private _listeningExpectations: Map<ExpectationId, ExpectationId[]> = new Map()

	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('ListeningExpectations')
	}

	/**
	 * Repopulate the cache of which expectations are listening to whom
	 */
	public rePopulate(): void {
		this._listeningExpectations.clear()
		// Go through all expectations:
		for (const trackedExp of this.tracker.getSortedTrackedExpectations()) {
			if (trackedExp.exp.triggerByFulfilledIds) {
				// Go through the ids of expectations that are listening to this expectation:
				for (const listeningToId of trackedExp.exp.triggerByFulfilledIds) {
					if (listeningToId === trackedExp.id) {
						this.logger.warn(`triggerByFulfilledIds not allowed to contain it's own id: "${trackedExp.id}"`)
						continue // ignore references to self
					}

					let listening = this._listeningExpectations.get(listeningToId)
					if (!listening) {
						listening = []
						this._listeningExpectations.set(listeningToId, listening)
					}
					listening.push(trackedExp.id)
				}
			}
		}
	}
	/** Returns a list of the expectations that are listening to this id */
	public getListeningExpectations(id: ExpectationId): ExpectationId[] {
		return this._listeningExpectations.get(id) ?? []
	}
}
