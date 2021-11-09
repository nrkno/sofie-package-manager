import WebSocket from 'ws'
import { stringifyError } from './lib'
import { LoggerInstance } from './logger'
import { MessageBase, MessageIdentifyClient, PING_TIME, WebsocketConnection } from './websocketConnection'

/** A Class which handles a connection to a Websocket server */
export class WebsocketClient extends WebsocketConnection {
	private pingTimeout?: NodeJS.Timeout
	private RETRY_CONNECT_TIME = 3000
	private closed = false

	private connecting = false
	private connected = false
	private reconnectTimeout: NodeJS.Timeout | null = null

	constructor(
		private logger: LoggerInstance,
		private readonly id: string,
		private readonly url: string,
		private readonly clientType: MessageIdentifyClient['clientType'],
		onMessage: (message: MessageBase) => Promise<any>
	) {
		super(onMessage)
	}

	async connect(): Promise<void> {
		if (this.ws) {
			this.ws.close()
			this.ws.removeAllListeners()
			delete this.ws
		}
		if (this.pingTimeout) clearTimeout(this.pingTimeout)
		this.connecting = true

		try {
			const ws = new WebSocket(this.url)
			this.ws = ws
			ws.on('ping', () => this.watchForHeartbeat())
			ws.once('close', () => {
				if (this.pingTimeout) clearTimeout(this.pingTimeout)
				this.onLostConnection()
			})
			ws.on('message', (message: string) => {
				this.handleReceivedMessage(JSON.parse(message))
			})

			await new Promise<void>((resolve, reject) => {
				ws.once('open', () => {
					this.watchForHeartbeat()

					const message: MessageIdentifyClient = {
						internalType: 'identify_client',
						clientType: this.clientType,
						id: this.id,
					}
					ws.send(JSON.stringify(message))

					this.emit('connected')
					this.connected = true

					resolve()
				})
				setTimeout(() => {
					reject('Connection timeout')
				}, 3000) // connection timeout
			})
			this.connecting = false
		} catch (err) {
			this.connecting = false
			throw err
		}
	}
	close(): void {
		this.closed = true
		this.ws?.close()
		this.ws?.removeAllListeners()
	}

	private onLostConnection() {
		if (this.connected) {
			this.emit('disconnected')
			this.connected = false
		}
		if (!this.closed) {
			this.triggerReconnect()
		}
	}
	private triggerReconnect() {
		// Try to reconnect:
		if (!this.reconnectTimeout) {
			this.reconnectTimeout = setTimeout(() => {
				this.reconnectTimeout = null
				this.reconnect()
			}, this.RETRY_CONNECT_TIME)
		}
	}
	private reconnect() {
		if (this.connected) return // Do nothing if we're already connected

		if (!this.connecting) {
			this.connect().catch((err) => {
				this.logger.error(`Error in WebsocketClient.connect: ${stringifyError(err)}`)

				// If the connect fails, try again later:
				this.onLostConnection()
			})
		} else {
			// Check again later:
			this.triggerReconnect()
		}
	}
	private watchForHeartbeat() {
		// We expect the server to ping us continuously

		if (this.pingTimeout) clearTimeout(this.pingTimeout)

		this.pingTimeout = setTimeout(() => {
			// Use `WebSocket#terminate()`, which immediately destroys the connection,
			// instead of `WebSocket#close()`, which waits for the close timer.
			if (this.ws) {
				this.ws.terminate()
				delete this.ws
			}

			this.onLostConnection()
		}, PING_TIME + 1000)
	}
}
