import EventEmitter from 'events'
/* eslint-disable no-console */

/** An EventEmitter which does a check that you've remembered to listen to the 'error' event */
export class HelpfulEventEmitter extends EventEmitter {
	private _listenersToCheck: string[] = ['error']

	constructor() {
		super()
		// Ensure that the error event is listened for:

		const orgError = new Error('No error event listener registered')

		setImmediate(() => {
			setImmediate(() => {
				for (const event of this._listenersToCheck) {
					if (!this.listenerCount(event)) {
						// If no event listener is registered, log a warning to let the developer
						// know that they should do so:
						console.error(`WARNING: No "${event}" event listener registered`)
						console.error(`Stack: ${orgError.stack}`)

						// If we're running in Jest, it's better to make it a little more obvious that something is wrong:
						if (process.env.JEST_WORKER_ID !== undefined) {
							// Since no error listener is registered, this'll cause the process to exit and tests to fail:
							this.emit('error', orgError)
						}
					}
				}

				// If we're running in Jest, it's better to make it a little more obvious that something is wrong:
				if (process.env.JEST_WORKER_ID !== undefined && !this.listenerCount('error')) {
					// Since no error listener is registered, this'll cause the process to exit and tests to fail:
					this.emit('error', orgError)
				}
			})
		})
	}

	/**
	 * To be called in constructor.
	 * Add an event that the HelpfulEventEmitter should check that it is being listened to
	 */
	protected addHelpfulEventCheck(event: string): void {
		if (this._listenersToCheck.includes(event)) throw new Error(`Event "${event}" already added`)

		this._listenersToCheck.push(event)
	}
}
