import * as WebSocket from 'ws'

import { MessageBase, MessageIdentifyClient, PING_TIME, WebsocketConnection } from './websocketConnection'

export type OnMessageHandler = (message: MessageBase) => Promise<any>

export class WebsocketServer {
	private wss: WebSocket.Server
	private clients: ClientConnection[] = []

	constructor(
		port: number,
		// private requestMessageHandler: (clientType: string) => OnMessageHandler,
		private onConnection: (client: ClientConnection, clientType: string) => void
	) {
		this.wss = new WebSocket.Server({ port: port })

		this.wss.on('close', () => {
			this.clients.forEach((client) => {
				client._onLostConnection()
			})
		})

		this.wss.on('connection', (ws) => {
			// A new client has connected

			const client = new ClientConnection(ws, () => Promise.reject('Not setup yet'))
			this.clients.push(client)

			client.on('close', () => {
				// Remove client from the list of clients
				this.clients = this.clients.filter((c) => c !== client)
			})

			client.on('clientTypeReceived', (clientType) => {
				// const onMessage = this.requestMessageHandler(clientType)
				// client.setOnMessage(onMessage)

				this.onConnection(client, clientType)
			})
		})
	}

	terminate(): void {
		this.clients.forEach((client) => client.close())
		this.wss.close()
	}
}

export class ClientConnection extends WebsocketConnection {
	// implements IClientConnection<IncomingMessage, OutgoingMessage> {
	private pingInterval: NodeJS.Timeout
	private isAlive = true
	public clientType: MessageIdentifyClient['clientType'] = 'N/A'
	public clientId = 'N/A'

	constructor(ws: WebSocket, onMessage: (message: MessageBase) => Promise<any>) {
		super(onMessage)

		this.ws = ws

		// Continuously ping the client:
		this.pingInterval = setInterval(() => {
			if (this.ws) {
				if (this.isAlive === false) {
					this.ws.terminate()
					delete this.ws
					this._onLostConnection()
				} else {
					this.isAlive = false
					this.ws.ping() // client will reply with 'pong'
				}
			} else {
				// This shouldn't really ever happen
				this._onLostConnection()
			}
		}, PING_TIME)
		this.ws.on('pong', () => {
			this.isAlive = true
		})
		this.ws.on('close', () => {
			this._onLostConnection()
		})
		this.ws.on('message', (messageStr: string) => {
			const message = JSON.parse(messageStr)

			if (message.internalType === 'identify_client') {
				const ident = (message as unknown) as MessageIdentifyClient
				this.clientType = ident.clientType
				this.clientId = ident.id
				this.emit('clientTypeReceived', this.clientType)
			} else {
				this.handleReceivedMessage(message)
			}
		})
	}

	_onLostConnection(): void {
		clearTimeout(this.pingInterval)
		this.emit('close')
	}
	close() {
		this.ws?.close()
	}
}

/*
new WebsocketServer(
	8080,
	(_clientType: string) => {
		// handle message
		return async (_message: MessageBase) => {}
	},
	(_client) => {}
)
*/
