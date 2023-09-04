import { ExpectationId } from '@sofie-package-manager/api'
import { sortTrackedExpectations, TrackedExpectation } from '../../lib/trackedExpectation'
import { ExpectationTracker } from '../expectationTracker'

/** Storage for Expectations */
export class TrackedExpectationsStorage {
	private trackedExpectations: Map<ExpectationId, TrackedExpectation> = new Map()

	private cacheIsDirty = true
	private cacheIds: ExpectationId[] = []
	private cacheList: TrackedExpectation[] = []

	constructor(private tracker: ExpectationTracker) {}

	public get(id: ExpectationId): TrackedExpectation | undefined {
		return this.trackedExpectations.get(id)
	}
	public getIds(): ExpectationId[] {
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
	public upsert(id: ExpectationId, trackedExp: TrackedExpectation): void {
		if (trackedExp.id !== id) throw new Error(`Internal Error: upsert: id not matching trackedExpectation id!`)

		this.trackedExpectations.set(id, trackedExp)
		this.cacheIsDirty = true
	}
	public remove(id: ExpectationId): void {
		this.trackedExpectations.delete(id)
		this.cacheIsDirty = true
	}
	public clear(): void {
		this.trackedExpectations.clear()
		this.cacheIsDirty = true
	}

	private updateCache(): void {
		if (!this.cacheIsDirty) return

		this.cacheList = sortTrackedExpectations(this.trackedExpectations, this.tracker.constants)
		this.cacheIds = this.cacheList.map((e) => e.id)

		this.cacheIsDirty = false
	}
}
