import EventEmitter from 'events'
/* eslint-disable no-console */

/** An EventEmitter which does a check that you've remembered to listen to the 'error' event */
export class HelpfulEventEmitter extends EventEmitter {
	constructor() {
		super()
		// Ensure that the error event is listened for:

		const orgError = new Error('No error event listener registered')
		setTimeout(() => {
			if (!this.listenerCount('error')) {
				// If no error event listener is registered, log a warning to let the developer
				// know that they should do so:
				console.error('WARNING: No error event listener registered')
				console.error(`Stack: ${orgError.stack}`)

				// If we're running in Jest, it's better to make it a little more obvious that something is wrong:
				if (process.env.JEST_WORKER_ID !== undefined) {
					// Since no error listener is registered, this'll cause the process to exit and tests to fail:
					this.emit('error', orgError)
				}
			}
		}, 1)
	}
}
