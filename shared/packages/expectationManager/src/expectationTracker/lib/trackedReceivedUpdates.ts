import {
	PackageContainerId,
	Expectation,
	ExpectationId,
	PackageContainerExpectation,
	ensureArray,
	AnyProtectedString,
	objectKeys,
} from '@sofie-package-manager/api'
import _ from 'underscore'

/** Store for various incoming data, to be processed on next iteration round */
export class TrackedReceivedUpdates {
	/** Store for incoming Expectations */
	private _expectations: Map<ExpectationId, Expectation.Any> = new Map()
	/** Set to true when there have been changes to expectations.receivedUpdates */
	private _expectationsHasBeenUpdated = false

	/** Store for incoming Restart-calls */
	private _restartExpectations: Set<ExpectationId> = new Set()
	/** Store for incoming Abort-calls */
	private _abortExpectations: Set<ExpectationId> = new Set()
	/** Store for incoming RestartAll-calls */
	private _restartAllExpectations = false

	/** Store for incoming PackageContainerExpectations */
	private _packageContainers: Map<PackageContainerId, PackageContainerExpectation> = new Map()
	/** Set to true when there have been changes to expectations.receivedUpdates */
	private _packageContainersHasBeenUpdated = false

	/** Store for incoming restart-container calls */
	private _restartPackageContainers: Set<PackageContainerId> = new Set()

	public clear(): void {
		this._expectations.clear()
		this._expectationsHasBeenUpdated = true
		this._packageContainers.clear()
		this._packageContainersHasBeenUpdated = true
		this._restartExpectations.clear()
		this._abortExpectations.clear()
		this._restartPackageContainers.clear()
		this._restartAllExpectations = false
	}

	public get expectationsHasBeenUpdated(): boolean {
		return this._expectationsHasBeenUpdated
	}
	public set expectationsHasBeenUpdated(value: boolean) {
		this._expectationsHasBeenUpdated = value
	}
	// public get expectations(): Map<ExpectationId, Expectation.Any> {
	// 	return this._expectations
	// }
	getExpectations(): IterableIterator<Expectation.Any> {
		return this._expectations.values()
	}
	expectationExist(id: ExpectationId): boolean {
		return this._expectations.has(id)
	}
	public setExpectations(newValues: Record<ExpectationId, Expectation.Any>): void {
		const changed = this.setMap(this._expectations, newValues)
		if (changed) {
			this._expectationsHasBeenUpdated = true
		}
	}

	public getRestartExpectations(): ExpectationId[] {
		return Array.from(this._restartExpectations.values())
	}
	public restartExpectations(ids: ExpectationId | ExpectationId[]): void {
		for (const id of ensureArray(ids)) {
			if (!this._restartExpectations.has(id)) {
				this._restartExpectations.add(id)
				this._expectationsHasBeenUpdated = true
			}
		}
	}
	public clearRestartExpectations(): void {
		this._restartExpectations.clear()
	}
	public getAbortExpectations(): ExpectationId[] {
		return Array.from(this._abortExpectations.values())
	}
	public abortExpectations(ids: ExpectationId | ExpectationId[]): void {
		for (const id of ensureArray(ids)) {
			if (!this._abortExpectations.has(id)) {
				this._abortExpectations.add(id)
				this._expectationsHasBeenUpdated = true
			}
		}
	}
	public clearAbortExpectations(): void {
		this._abortExpectations.clear()
	}

	public get restartAllExpectations(): boolean {
		return this._restartAllExpectations
	}
	public set restartAllExpectations(value: boolean) {
		if (this._restartAllExpectations !== value) {
			this._restartAllExpectations = value
			this._expectationsHasBeenUpdated = true
		}
	}

	public get packageContainersHasBeenUpdated(): boolean {
		return this._packageContainersHasBeenUpdated
	}
	public set packageContainersHasBeenUpdated(value: boolean) {
		this._packageContainersHasBeenUpdated = value
	}

	public getPackageContainers(): PackageContainerExpectation[] {
		return Array.from(this._packageContainers.values())
	}
	public getPackageContainer(id: PackageContainerId): PackageContainerExpectation | undefined {
		return this._packageContainers.get(id)
	}
	public setPackageContainers(newMap: Record<PackageContainerId, PackageContainerExpectation>): void {
		const changed = this.setMap(this._packageContainers, newMap)
		if (changed) {
			this._packageContainersHasBeenUpdated = true
		}
	}

	public isRestartPackageContainer(containerId: PackageContainerId): boolean {
		return this._restartPackageContainers.has(containerId)
	}
	public restartPackageContainers(containerIds: PackageContainerId | PackageContainerId[]): void {
		for (const containerId of ensureArray(containerIds)) {
			if (!this._restartPackageContainers.has(containerId)) {
				this._restartPackageContainers.add(containerId)
				this._packageContainersHasBeenUpdated = true
			}
		}
	}

	private setMap<T extends { id: K }, K extends AnyProtectedString>(
		existing: Map<K, T>,
		incoming: Record<K, T>
	): boolean {
		let changed = false
		for (const id of _.uniq([...existing.keys(), ...objectKeys(incoming)])) {
			const incomingValue = incoming[id] as T | undefined

			if (!_.isEqual(existing.get(id), incomingValue)) {
				if (incomingValue) {
					// ensure that the id is the same as the key:
					if (incomingValue.id !== id)
						throw new Error(`key "${id}" does not match .id property "${incomingValue.id}"`)

					existing.set(id, incomingValue)
				} else {
					existing.delete(id)
				}

				changed = true
			}
		}

		return changed
	}
}
