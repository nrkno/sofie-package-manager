import { StatusCode, MonitorProperties, Reason, stringifyError, HelpfulEventEmitter } from '@sofie-package-manager/api'

export interface MonitorInProgressEvents {
	status: (status: StatusCode, reason: Reason) => void
}
export declare interface IMonitorInProgress {
	properties: MonitorProperties
	on<U extends keyof MonitorInProgressEvents>(event: U, listener: MonitorInProgressEvents[U]): this
	emit<U extends keyof MonitorInProgressEvents>(event: U, ...args: Parameters<MonitorInProgressEvents[U]>): boolean

	/** Stop the monitor */
	stop: () => Promise<void>
}
export class MonitorInProgress extends HelpfulEventEmitter implements IMonitorInProgress {
	private statuses: Map<string, { status: StatusCode; reason: Reason }> = new Map()
	private lastReportedStatus: { status: StatusCode; reason: Reason } | undefined = undefined
	constructor(public properties: MonitorProperties, private _onStop: () => Promise<void>) {
		super()
	}
	async stop(): Promise<void> {
		return this._onStop()
	}

	_setStatus(internalId: string, status: StatusCode, reason: Reason): void {
		this.statuses.set(internalId, { status, reason })

		this._reportStatus()
	}
	_unsetStatus(internalId: string): void {
		this.statuses.delete(internalId)

		this._reportStatus()
	}
	private _reportStatus(): void {
		// Emit the worst status:
		let worstStatus: { status: StatusCode; reason: Reason } | undefined = undefined
		for (const status of this.statuses.values()) {
			if (!worstStatus || worstStatus.status < status.status) {
				worstStatus = status
			}
		}

		if (!worstStatus)
			worstStatus = {
				status: StatusCode.UNKNOWN,
				reason: {
					user: 'Not yet initialized',
					tech: 'Not yet initialized',
				},
			}

		if (this.lastReportedStatus?.status !== worstStatus.status) {
			this.lastReportedStatus !== worstStatus

			this.emit('status', worstStatus.status, worstStatus.reason)
		}
	}
	/** Convenience function which calls the function that sets up the monitor */
	setup(fcn: () => Promise<void> | void): MonitorInProgress {
		setTimeout(() => {
			try {
				Promise.resolve(fcn()).catch((err) => {
					this._setStatus('setup', StatusCode.BAD, {
						user: 'Internal error when setting up monitor',
						tech: `Error: ${stringifyError(err)}`,
					})
				})
			} catch (err) {
				this._setStatus('setup', StatusCode.BAD, {
					user: 'Internal error when setting up monitor',
					tech: `Error: ${stringifyError(err)}`,
				})
			}
		}, 1)
		return this
	}
}
