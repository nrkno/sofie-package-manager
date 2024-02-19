import { PackageContainerId } from '@sofie-package-manager/api'
import { TrackedPackageContainerExpectation } from '../../lib/trackedPackageContainerExpectation'

/** Storage for Tracked PackageContainerExpectations*/
export class TrackedPackageContainersStorage {
	private trackedPackageContainers: Map<PackageContainerId, TrackedPackageContainerExpectation> = new Map()

	private cacheIsDirty = true
	private cacheIds: PackageContainerId[] = []
	private cacheList: TrackedPackageContainerExpectation[] = []

	public get(containerId: PackageContainerId): TrackedPackageContainerExpectation | undefined {
		return this.trackedPackageContainers.get(containerId)
	}
	public getIds(): PackageContainerId[] {
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
	public upsert(containerId: PackageContainerId, trackedPackageContainer: TrackedPackageContainerExpectation): void {
		if (trackedPackageContainer.id !== containerId)
			throw new Error(`Internal Error: upsert: id not matching packageContainer id!`)

		this.trackedPackageContainers.set(containerId, trackedPackageContainer)
		this.cacheIsDirty = true
	}
	public remove(containerId: PackageContainerId): void {
		this.trackedPackageContainers.delete(containerId)
		this.cacheIsDirty = true
	}
	public clear(): void {
		this.trackedPackageContainers.clear()
		this.cacheIsDirty = true
	}

	private updateCache(): void {
		if (!this.cacheIsDirty) return

		this.cacheList = Array.from(this.trackedPackageContainers.values())
		this.cacheIds = this.cacheList.map((e) => e.id)

		this.cacheIsDirty = false
	}
}
