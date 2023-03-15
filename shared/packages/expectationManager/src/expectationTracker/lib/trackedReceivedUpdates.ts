import { Expectation, PackageContainerExpectation } from '@sofie-package-manager/api'
import _ from 'underscore'

/** Store for various incoming data, to be processed on next iteration round */
export class TrackedReceivedUpdates {
	/** Store for incoming Expectations */
	private _expectations: { [id: string]: Expectation.Any } = {}
	/** Set to true when there have been changes to expectations.receivedUpdates */
	private _expectationsHasBeenUpdated = false

	/** Store for incoming Restart-calls */
	private _restartExpectations: { [id: string]: true } = {}
	/** Store for incoming Abort-calls */
	private _abortExpectations: { [id: string]: true } = {}
	/** Store for incoming RestartAll-calls */
	private _restartAllExpectations = false

	/** Store for incoming PackageContainerExpectations */
	private _packageContainers: { [id: string]: PackageContainerExpectation } = {}
	/** Set to true when there have been changes to expectations.receivedUpdates */
	private _packageContainersHasBeenUpdated = false

	/** Store for incoming restart-container calls */
	private _restartPackageContainers: { [containerId: string]: true } = {}

	public clear(): void {
		this._expectations = {}
		this._expectationsHasBeenUpdated = false
		this._packageContainers = {}
		this._packageContainersHasBeenUpdated = false
		this._restartExpectations = {}
		this._abortExpectations = {}
		this._restartPackageContainers = {}
		this._restartAllExpectations = false
	}

	public get expectationsHasBeenUpdated(): boolean {
		return this._expectationsHasBeenUpdated
	}
	public set expectationsHasBeenUpdated(value: boolean) {
		this._expectationsHasBeenUpdated = value
	}
	public get expectations(): { [id: string]: Expectation.Any } {
		return this._expectations
	}
	public set expectations(value: { [id: string]: Expectation.Any }) {
		if (!_.isEqual(this._expectations, value)) {
			this._expectations = value
			this._expectationsHasBeenUpdated = true
		}
	}

	public get restartExpectations(): { [id: string]: true } {
		return this._restartExpectations
	}
	public set restartExpectations(value: { [id: string]: true }) {
		if (!_.isEqual(this._restartExpectations, value)) {
			this._restartExpectations = value
			this._expectationsHasBeenUpdated = true
		}
	}

	public get abortExpectations(): { [id: string]: true } {
		return this._abortExpectations
	}
	public set abortExpectations(value: { [id: string]: true }) {
		if (!_.isEqual(this._abortExpectations, value)) {
			this._abortExpectations = value
			this._expectationsHasBeenUpdated = true
		}
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
	public get packageContainers(): { [id: string]: PackageContainerExpectation } {
		return this._packageContainers
	}
	public set packageContainers(value: { [id: string]: PackageContainerExpectation }) {
		this._packageContainers = value
		this._packageContainersHasBeenUpdated = true
	}

	public get restartPackageContainers(): { [containerId: string]: true } {
		return this._restartPackageContainers
	}
	public set restartPackageContainers(value: { [containerId: string]: true }) {
		this._restartPackageContainers = value
		this._packageContainersHasBeenUpdated = true
	}
}
