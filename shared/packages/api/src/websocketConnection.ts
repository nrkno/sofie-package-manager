import WebSocket from 'ws'
import EventEmitter from 'events'

export const PING_TIME = 10 * 1000
export const MESSAGE_TIMEOUT = 5000

export abstract class WebsocketConnection extends EventEmitter {
	protected ws?: WebSocket
	private messageId = 0
	private replies: {
		[messageId: string]: {
			resolve: (result: any) => void
			reject: (error: any) => void
			timeout: NodeJS.Timeout
		}
	} = {}

	constructor(private _onMessage: (message: MessageBase) => Promise<any>) {
		super()
	}

	async send(type: string, ...args: any[]): Promise<any> {
		if (this.ws) {
			const msg: MessageBase = {
				i: this.messageId++,
				type: type,
				args: args,
			}
			this.ws.send(JSON.stringify(msg))

			return new Promise((resolve, reject) => {
				this.replies[msg.i + ''] = {
					resolve,
					reject,
					timeout: setTimeout(() => {
						// Timeout:
						const reply: MessageReply = {
							i: msg.i,
							r: true,
							error: 'Error: Websocket message timeout',
						}
						this.handleReceivedMessage(reply)
					}, MESSAGE_TIMEOUT),
				}
			})
		} else {
			throw new Error('Websocket not established yet!')
		}
	}
	protected handleReceivedMessage(message: MessageAny): void {
		if ((message as any).r) {
			const msg = message as MessageReply
			const waitingReply = this.replies[msg.i + '']
			if (waitingReply) {
				if (msg.error) {
					waitingReply.reject(msg.error)
				} else {
					waitingReply.resolve(msg.result)
				}
				clearTimeout(waitingReply.timeout)
				delete this.replies[msg.i + '']
			}
		} else {
			const msg = message as MessageBase

			this._onMessage(msg)
				.then((result: any) => {
					const reply: MessageReply = {
						r: true,
						i: msg.i,
						result: result,
					}
					this.ws?.send(JSON.stringify(reply))
				})
				.catch((error: any) => {
					const reply: MessageReply = {
						r: true,
						i: msg.i,
						error: error.toString(),
					}
					this.ws?.send(JSON.stringify(reply))
				})
		}
	}

	onMessage(newOnMessage: (message: MessageBase) => Promise<any>): void {
		this._onMessage = newOnMessage
	}
}
export type MessageAny = MessageBase | MessageReply
export interface MessageBase {
	/** Message id */
	i: number
	type: string
	args: any[]
}
export interface MessageReply {
	/** Message id */
	i: number
	r: true
	result?: any
	error?: string
}
export interface MessageIdentifyClient {
	internalType: 'identify_client'
	clientType: 'N/A' | 'workerAgent' | 'expectationManager' | 'appContainer'
	id: string
}

/** A Hook defines */
export type Hook<ServerMethods, ClientMethods> = (clientId: string, clientHook: ClientMethods) => ServerMethods
