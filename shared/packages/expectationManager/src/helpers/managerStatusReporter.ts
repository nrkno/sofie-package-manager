import _ from 'underscore'
import { StatusCode, Statuses } from '@sofie-package-manager/api'
import { ExpectationManagerCallbacks } from '../expectationManager'

/** Coordinates the ExpectationManager statuses and reports the status updates */
export class ManagerStatusReporter {
	private statuses: Statuses = {}
	constructor(private managerCallbacks: ExpectationManagerCallbacks) {}

	/**
	 * Update a status.
	 * If the status has changed, a new set of Statuses will be emitted.
	 */
	public update(id: string, status: { statusCode: StatusCode; message: string } | null): void {
		const existingStatus = this.statuses[id]

		let changed = false
		if (status) {
			if (!existingStatus || !_.isEqual(existingStatus, status)) {
				changed = true
			}
		} else {
			if (existingStatus) {
				this.statuses[id] = status
				changed = true
			}
		}

		if (changed) {
			this.statuses[id] = status
			this.managerCallbacks.reportManagerStatus(this.statuses)
		}
	}
}
