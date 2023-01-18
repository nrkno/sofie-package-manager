import { ExpectationTracker, TrackedExpectation } from '../expectationTracker'
import { sortTrackedExpectations } from '../lib/expectations'

/** Storage for Expectations */
export class TrackedExpectations {
	private trackedExpectations: { [id: string]: TrackedExpectation } = {}

	private cacheIsDirty = true
	private cacheIds: string[] = []
	private cacheList: TrackedExpectation[] = []

	constructor(private tracker: ExpectationTracker) {}

	public get(id: string): TrackedExpectation | undefined {
		return this.trackedExpectations[id]
	}
	public getIds(): string[] {
		this.updateCache()
		return this.cacheIds
	}
	/**
	 * @returns A sorted list of all tracked Expectations
	 */
	public list(): TrackedExpectation[] {
		this.updateCache()
		return this.cacheList
	}
	/** Add or Update a tracked Expectation */
	public upsert(id: string, trackedExp: TrackedExpectation): void {
		if (trackedExp.id !== id) throw new Error(`Internal Error: upsert: id not matching trackedExpectation id!`)

		this.trackedExpectations[id] = trackedExp
		this.cacheIsDirty = true
	}
	public remove(id: string): void {
		delete this.trackedExpectations[id]
		this.cacheIsDirty = true
	}
	public clear(): void {
		this.trackedExpectations = {}
		this.cacheIsDirty = true
	}

	private updateCache(): void {
		if (!this.cacheIsDirty) return

		this.cacheList = sortTrackedExpectations(this.trackedExpectations, this.tracker.constants)
		this.cacheIds = this.cacheList.map((e) => e.id)

		this.cacheIsDirty = false
	}
}
