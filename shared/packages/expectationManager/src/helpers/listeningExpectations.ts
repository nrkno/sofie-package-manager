import { LoggerInstance } from '@sofie-package-manager/api'
import { ExpectationTracker } from '../expectationTracker'

/** Keeps track of which Expectations are waiting for the fullfillment of other Expectations */
export class ListeningExpectations {
	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private tracker: ExpectationTracker) {
		this.logger = logger.category('ListeningExpectations')
	}

	/**
	 * key-value store of which expectations are triggered when another is fullfilled.
	 * The value is a list of the expectations that listen to the fullfillment
	 * The key is the id of the expectation they are listening to
	 */
	private _listeningExpectations: { [fullfilledId: string]: string[] } = {}

	/**
	 * Repopulate the cache of which expectations are listening to whom
	 */
	public rePopulate(): void {
		this._listeningExpectations = {}
		// Go through all expectations:
		for (const trackedExp of this.tracker.getSortedTrackedExpectations()) {
			if (trackedExp.exp.triggerByFullfilledIds) {
				// Go through the ids of expectations that are listening to this expextation:
				for (const listeningToId of trackedExp.exp.triggerByFullfilledIds) {
					if (listeningToId === trackedExp.id) {
						this.logger.warn(
							`triggerByFullfilledIds not allowed to contain it's own id: "${trackedExp.id}"`
						)
						continue // ignore references to self
					}

					if (!this._listeningExpectations[listeningToId]) {
						this._listeningExpectations[listeningToId] = []
					}
					this._listeningExpectations[listeningToId].push(trackedExp.id)
				}
			}
		}
	}
	/** Returns a list of the expectations that are listening to this id */
	public getListeningExpectations(id: string): string[] {
		return this._listeningExpectations[id] || []
	}
}
