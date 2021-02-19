import * as WebSocket from 'ws'
import { MessageBase, MessageIdentifyClient, PING_TIME, WebsocketConnection } from './websocketConnection'

export class WebsocketClient extends WebsocketConnection {
	private pingTimeout?: NodeJS.Timeout
	private RETRY_CONNECT_TIME = 3000
	private closed = false

	constructor(
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

		const ws = new WebSocket(this.url)
		this.ws = ws
		ws.on('ping', () => this.watchForHeartbeat())
		ws.on('close', () => {
			if (this.pingTimeout) clearTimeout(this.pingTimeout)
			this.onLostConnection()
		})
		ws.on('open', () => {
			this.emit('connected')
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

				resolve()
			})
			setTimeout(reject, 3000) // connection timeout
		})
	}
	close(): void {
		this.closed = true
		this.ws?.close()
		// todo: clean up listeners?
	}

	private onLostConnection() {
		this.emit('disconnected')
		if (!this.closed) {
			// Try to reconnect:
			setTimeout(() => {
				this.reconnect()
			}, this.RETRY_CONNECT_TIME)
		}
	}
	private reconnect() {
		this.connect().catch((err) => {
			console.error(err)
			this.onLostConnection()
		})
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
