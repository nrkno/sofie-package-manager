import { TrackedPackageContainerExpectation } from '../expectationTracker'

/** Storage for Tracked PackageContainerExpectations*/
export class TrackedPackageContainers {
	private trackedPackageContainers: { [id: string]: TrackedPackageContainerExpectation } = {}

	private cacheIsDirty = true
	private cacheIds: string[] = []
	private cacheList: TrackedPackageContainerExpectation[] = []

	public get(containerId: string): TrackedPackageContainerExpectation | undefined {
		return this.trackedPackageContainers[containerId]
	}
	public getIds(): string[] {
		this.updateCache()
		return this.cacheIds
	}
	/**
	 * @returns A list of all tracked PackageContainers
	 */
	public list(): TrackedPackageContainerExpectation[] {
		this.updateCache()
		return this.cacheList
	}
	/** Add or Update a tracked PackageContainer */
	public upsert(containerId: string, trackedPackageContainer: TrackedPackageContainerExpectation): void {
		if (trackedPackageContainer.id !== containerId)
			throw new Error(`Internal Error: upsert: id not matching packageContainer id!`)

		this.trackedPackageContainers[containerId] = trackedPackageContainer
		this.cacheIsDirty = true
	}
	public remove(containerId: string): void {
		delete this.trackedPackageContainers[containerId]
		this.cacheIsDirty = true
	}
	public clear(): void {
		this.trackedPackageContainers = {}
		this.cacheIsDirty = true
	}

	private updateCache(): void {
		if (!this.cacheIsDirty) return

		this.cacheList = Object.values(this.trackedPackageContainers)
		this.cacheIds = this.cacheList.map((e) => e.id)

		this.cacheIsDirty = false
	}
}
