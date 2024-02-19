import { promiseTimeout, stringifyError } from './lib'
import { MethodsInterfaceBase } from './methods'
import { ACTION_TIMEOUT, MessageBase } from './websocketConnection'
import { ClientConnection } from './websocketServer'

/**
 * The AdapterServer's sub-classes are used to expose a type-safe API for AdapterClients to connect to, in order to communicaten between processes (using web-sockets),
 * or (in the case where they run in the same process) hook directly into the AdapterServer, to call the methods directly.
 * @see {@link ./adapterClient.ts}
 */
export abstract class AdapterServer<ME extends MethodsInterfaceBase, OTHER extends MethodsInterfaceBase> {
	protected _sendMessage: (type: keyof Omit<OTHER, 'id'>, ...args: any[]) => Promise<any>

	public readonly type: string

	constructor(serverMethods: ME, options: AdapterServerOptions<OTHER>) {
		this.type = options.type

		if (options.type === 'websocket') {
			this._sendMessage = (async (type: string, ...args: any[]) =>
				options.clientConnection.send(type, ...args)) as any

			options.clientConnection.onMessage(async (message: MessageBase) => {
				// Handle message from the WorkerAgent:
				const fcn = (serverMethods as any)[message.type]
				if (fcn) {
					// Call the method, and ensure that it resolves in time:

					// Note: It is better if the receiver times out the method call than the other party.
					// This way we can differ between the called method timing out and a websocket timeout.

					return promiseTimeout(fcn.call(serverMethods, ...message.args), ACTION_TIMEOUT, (timeoutDuration) =>
						this.timeoutMessage(timeoutDuration, message.type, message.args)
					)
				} else {
					throw new Error(`Unknown method "${message.type}"`)
				}
			})
		} else {
			const clientHook: Omit<OTHER, 'id'> = options.hookMethods
			this._sendMessage = async (type: keyof Omit<OTHER, 'id'>, ...args: any[]) => {
				const fcn = clientHook[type] as unknown as (...args: any[]) => any
				if (fcn) {
					try {
						return await promiseTimeout(fcn(...args), ACTION_TIMEOUT, (timeoutDuration) =>
							this.timeoutMessage(timeoutDuration, type, args)
						)
					} catch (err) {
						throw new Error(`Error when executing method "${String(type)}": ${stringifyError(err)}`)
					}
				} else {
					throw new Error(`Unknown method "${String(type)}"`)
				}
			}
		}
	}
	private timeoutMessage(timeoutDuration: number, type: any, args: any[]): string {
		const explainArgs = JSON.stringify(args).slice(0, 100) // limit the arguments to 100 chars
		const receivedTime = new Date().toLocaleTimeString()

		return `Timeout of function "${type}" after ${timeoutDuration} ms: ${explainArgs} (received: ${receivedTime})`
	}
}
/** Options for the AdapterServer */
export type AdapterServerOptions<OTHER extends MethodsInterfaceBase> =
	| { type: 'websocket'; clientConnection: ClientConnection }
	| { type: 'internal'; hookMethods: Omit<OTHER, 'id'> }
