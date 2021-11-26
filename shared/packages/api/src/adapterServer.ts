import { promiseTimeout, stringifyError } from './lib'
import { ACTION_TIMEOUT, MessageBase } from './websocketConnection'
import { ClientConnection } from './websocketServer'

/**
 * The AdapterServer's sub-classes are used to expose a type-safe API for AdapterClients to connect to, in order to communicaten between processes (using web-sockets),
 * or (in the case where they run in the same process) hook directly into the AdapterServer, to call the methods directly.
 * @see {@link ./adapterClient.ts}
 */
export abstract class AdapterServer<ME, OTHER> {
	protected _sendMessage: (type: keyof OTHER, ...args: any[]) => Promise<any>

	public readonly type: string

	constructor(serverMethods: ME, options: AdapterServerOptions<OTHER>) {
		this.type = options.type

		if (options.type === 'websocket') {
			this._sendMessage = ((type: string, ...args: any[]) => options.clientConnection.send(type, ...args)) as any

			options.clientConnection.onMessage(async (message: MessageBase) => {
				// Handle message from the WorkerAgent:
				const fcn = (serverMethods as any)[message.type]
				if (fcn) {
					// Call the method, and ensure that it resolves in time:

					// Note: It is better if the receiver times out the method call than the other party.
					// This way we can differ between the called method timing out and a websocket timeout.

					return promiseTimeout(
						fcn.call(serverMethods, ...message.args),
						ACTION_TIMEOUT,
						this.timeoutMessage(message.type, message.args)
					)
				} else {
					throw new Error(`Unknown method "${message.type}"`)
				}
			})
		} else {
			const clientHook: OTHER = options.hookMethods
			this._sendMessage = async (type: keyof OTHER, ...args: any[]) => {
				const fcn = (clientHook[type] as unknown) as (...args: any[]) => any
				if (fcn) {
					try {
						return await promiseTimeout(fcn(...args), ACTION_TIMEOUT, this.timeoutMessage(type, args))
					} catch (err) {
						throw new Error(`Error when executing method "${type}": ${stringifyError(err)}`)
					}
				} else {
					throw new Error(`Unknown method "${type}"`)
				}
			}
		}
	}
	private timeoutMessage(type: any, args: any[]): string {
		const explainArgs = JSON.stringify(args).slice(0, 100) // limit the arguments to 100 chars
		const receivedTime = new Date().toLocaleTimeString()

		return `Timeout of function "${type}": ${explainArgs} (received: ${receivedTime})`
	}
}
/** Options for the AdapterServer */
export type AdapterServerOptions<OTHER> =
	| { type: 'websocket'; clientConnection: ClientConnection }
	| { type: 'internal'; hookMethods: OTHER }
