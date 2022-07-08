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
	constructor(public properties: MonitorProperties, private _onStop: () => Promise<void>) {
		super()
	}
	async stop(): Promise<void> {
		return this._onStop()
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	_reportStatus(status: StatusCode, reason: Reason): void {
		this.emit('status', status, reason)
	}
	/** Convenience function which calls the function that sets up the monitor */
	setup(fcn: () => Promise<void> | void): MonitorInProgress {
		setTimeout(() => {
			try {
				Promise.resolve(fcn()).catch((err) => {
					this._reportStatus(StatusCode.BAD, {
						user: 'Internal error when setting up monitor',
						tech: `Error: ${stringifyError(err)}`,
					})
				})
			} catch (err) {
				this._reportStatus(StatusCode.BAD, {
					user: 'Internal error when setting up monitor',
					tech: `Error: ${stringifyError(err)}`,
				})
			}
		}, 1)
		return this
	}
}
