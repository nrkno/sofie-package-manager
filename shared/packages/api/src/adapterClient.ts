import { EventEmitter } from 'events'
import { LoggerInstance } from './logger'
import { WebsocketClient } from './websocketClient'
import { Hook, MessageBase, MessageIdentifyClient } from './websocketConnection'

/**
 * The AdapterClient's sub-classes are used to connect to an AdapterServer in order to provide type-safe communication between processes (using web-sockets),
 * or (in the case where they run in the same process) hook directly into the AdapterServer, to call the methods directly.
 * @see {@link ./adapterServer.ts}
 */
export abstract class AdapterClient<ME, OTHER> extends EventEmitter {
	/** Used for internal connections */
	private serverHook?: Hook<OTHER, ME>

	protected _sendMessage: (type: keyof OTHER, ...args: any[]) => Promise<any> = () => {
		throw new Error('.init() must be called first!')
	}

	constructor(protected logger: LoggerInstance, private clientType: MessageIdentifyClient['clientType']) {
		super()
	}

	private conn?: WebsocketClient
	private terminated = false

	private _connected = false

	async init(id: string, connectionOptions: ClientConnectionOptions, clientMethods: ME): Promise<void> {
		if (connectionOptions.type === 'websocket') {
			const conn = new WebsocketClient(
				this.logger,
				id,
				connectionOptions.url,
				this.clientType,
				async (message: MessageBase) => {
					// On message from other party:
					const fcn = (clientMethods as any)[message.type]
					if (fcn) {
						return fcn.call(clientMethods, ...message.args)
					} else {
						throw new Error(`Unknown method "${message.type}"`)
					}
				}
			)
			this.conn = conn

			conn.on('connected', () => {
				if (this.listenerCount('connected') === 0) {
					this.logger.debug(`Websocket client connected ("${id}", ${this.clientType})`)
				}
				this.emit('connected')
				this._connected = true
			})
			conn.on('disconnected', () => {
				if (this.listenerCount('disconnected') === 0) {
					this.logger.debug(`Websocket client disconnected ("${id}", ${this.clientType})`)
				}
				this.emit('disconnected')
				this._connected = false
			})
			this._sendMessage = ((type: string, ...args: any[]) => conn.send(type, ...args)) as any

			await conn.connect()
		} else {
			if (!this.serverHook)
				throw new Error(`AdapterClient: can't init() an internal connection, call hook() first!`)

			const serverHook: OTHER = this.serverHook(id, clientMethods)
			this._sendMessage = (type: keyof OTHER, ...args: any[]) => {
				if (this.terminated) throw new Error(`Can't send message due to being terminated`)

				const fcn = serverHook[type] as any
				if (fcn) {
					return fcn(...args)
				} else {
					throw new Error(`Unknown method "${type}"`)
				}
			}
		}
	}
	/** Used to hook into methods of the AdapterServer directly. Used when the server and client runs in the same process. */
	hook(serverHook: Hook<OTHER, ME>): void {
		this.serverHook = serverHook
	}
	terminate(): void {
		this.terminated = true
		this.conn?.close()
		delete this.serverHook
	}
	get connected(): boolean {
		return this._connected
	}
}
/** Options for an AdepterClient */
export type ClientConnectionOptions =
	| {
			type: 'websocket'
			/** URL to websocket server. Example: ws://www.host.com/path */
			url: string
	  }
	| {
			type: 'internal'
	  }
