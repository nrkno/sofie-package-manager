import { HelpfulEventEmitter } from './HelpfulEventEmitter'
import { promiseTimeout, stringifyError } from './lib'
import { LoggerInstance } from './logger'
import { WebsocketClient } from './websocketClient'
import { Hook, MessageBase, MessageIdentifyClient, ACTION_TIMEOUT } from './websocketConnection'

/**
 * The AdapterClient's sub-classes are used to connect to an AdapterServer in order to provide type-safe communication between processes (using web-sockets),
 * or (in the case where they run in the same process) hook directly into the AdapterServer, to call the methods directly.
 * @see {@link ./adapterServer.ts}
 */
export abstract class AdapterClient<ME, OTHER> extends HelpfulEventEmitter {
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
						// Call the method, and ensure that it resolves in time:

						// Note: It is better if the receiver times out the method call than the other party.
						// This way we can differ between the called method timing out and a websocket timeout.

						return promiseTimeout(
							fcn.call(clientMethods, ...message.args),
							ACTION_TIMEOUT,
							(timeoutDuration) => this.timeoutMessage(timeoutDuration, message.type, message.args)
						)
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
			conn.on('error', (err) => {
				this.logger.error(`AdapterClient: Error event: ${stringifyError(err)}`)
			})
			this._sendMessage = (async (type: string, ...args: any[]) => conn.send(type, ...args)) as any

			await conn.connect()
		} else {
			if (!this.serverHook)
				throw new Error(`AdapterClient: can't init() an internal connection, call hook() first!`)

			const serverHook: OTHER = this.serverHook(id, clientMethods)
			this._sendMessage = async (type: keyof OTHER, ...args: any[]) => {
				if (this.terminated) throw new Error(`Can't send message due to being terminated`)

				const fcn = serverHook[type] as any
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
			setTimeout(() => {
				this.emit('connected')
				this._connected = true
			}, 1)
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
	/** FOR DEBUGGING ONLY. Cut the connection in order to ensure that they are restarted */
	debugCutConnection(): void {
		// Delay the cut, to ensure that the message has time to propagate:
		setTimeout(() => {
			this.conn?._debugCutConnection()
		}, 1000)
	}
	get connected(): boolean {
		return this._connected
	}
	private timeoutMessage(timeoutDuration: number, type: any, args: any[]): string {
		const explainArgs = JSON.stringify(args).slice(0, 100) // limit the arguments to 100 chars
		const receivedTime = new Date().toLocaleTimeString()

		return `Timeout of function "${type}" after ${timeoutDuration} ms: ${explainArgs} (received: ${receivedTime})`
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
