import { promiseTimeout } from './lib'
import { MessageBase, MESSAGE_TIMEOUT } from './websocketConnection'
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
					return fcn(...message.args)
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
						return await promiseTimeout(fcn(...args), MESSAGE_TIMEOUT)
					} catch (err) {
						throw new Error(`Error in message "${type}": ${err.toString()}`)
					}
				} else {
					throw new Error(`Unknown method "${type}"`)
				}
			}
		}
	}
}
/** Options for the AdapterServer */
export type AdapterServerOptions<OTHER> =
	| { type: 'websocket'; clientConnection: ClientConnection }
	| { type: 'internal'; hookMethods: OTHER }
