import { MessageBase } from './websocketConnection'
import { ClientConnection } from './websocketServer'

export abstract class AdapterServer<ME, OTHER> {
	protected _sendMessage: (type: keyof OTHER, ...args: any[]) => Promise<any>

	constructor(serverMethods: ME, options: AdapterServerOptions<OTHER>) {
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
			this._sendMessage = (type: keyof OTHER, ...args: any[]) => {
				const fcn = (clientHook[type] as unknown) as (...args: any[]) => any
				if (fcn) {
					return fcn(...args)
				} else {
					throw new Error(`Unknown method "${type}"`)
				}
			}
		}
	}
}
export type ServerConnectionOptions =
	| {
			type: 'websocket'
			/** Port of the websocket server */
			port: number
	  }
	| {
			type: 'internal'
	  }

export type AdapterServerOptions<OTHER> =
	| { type: 'websocket'; clientConnection: ClientConnection }
	| { type: 'internal'; hookMethods: OTHER }
