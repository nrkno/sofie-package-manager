import { WebsocketClient } from './websocketClient'
import { Hook, MessageBase, MessageIdentifyClient } from './websocketConnection'

export abstract class AdapterClient<ME, OTHER> {
	/** Used for internal connections */
	private serverHook?: Hook<OTHER, ME>

	protected _sendMessage: (type: keyof OTHER, ...args: any[]) => Promise<any> = () => {
		throw new Error('.init() must be called first!')
	}

	constructor(private clientType: MessageIdentifyClient['clientType']) {}

	private conn?: WebsocketClient

	async init(id: string, connectionOptions: ClientConnectionOptions, clientMethods: ME): Promise<void> {
		if (connectionOptions.type === 'websocket') {
			const conn = new WebsocketClient(
				id,
				connectionOptions.url,
				this.clientType,
				async (message: MessageBase) => {
					// On message from other party:
					const fcn = (clientMethods as any)[message.type]
					if (fcn) {
						return fcn(...message.args)
					} else {
						throw new Error(`Unknown method "${message.type}"`)
					}
				}
			)
			this.conn = conn

			conn.on('connected', () => {
				console.log('Websocket client connected')
			})
			conn.on('disconnected', () => {
				console.log('Websocket client disconnected')
			})
			this._sendMessage = ((type: string, ...args: any[]) => conn.send(type, ...args)) as any

			await conn.connect()
		} else {
			// TODO
			if (!this.serverHook)
				throw new Error(`AdapterClient: can't init() an internal connection, call hook() first!`)

			const serverHook: OTHER = this.serverHook(id, clientMethods)
			this._sendMessage = (type: keyof OTHER, ...args: any[]) => {
				const fcn = serverHook[type] as any
				if (fcn) {
					return fcn(...args)
				} else {
					throw new Error(`Unknown method "${type}"`)
				}
			}
		}
	}
	hook(serverHook: Hook<OTHER, ME>): void {
		this.serverHook = serverHook
	}
	terminate(): void {
		this.conn?.close()
	}
}

export type ClientConnectionOptions =
	| {
			type: 'websocket'
			/** URL to websocket server. Example: ws://www.host.com/path */
			url: string
	  }
	| {
			type: 'internal'
	  }
