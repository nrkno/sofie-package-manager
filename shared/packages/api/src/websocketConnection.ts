import WebSocket from 'ws'
import { HelpfulEventEmitter } from './HelpfulEventEmitter'
import { isRunningInTest, stringifyError } from './lib'

import { AppContainerId, ExpectationManagerId, WorkerAgentId, WorkforceId } from './ids'
import { MethodsInterfaceBase } from './methods'
import { ProtectedString } from './ProtectedString'

export const PING_TIME = 10 * 1000
/**
 * Timeout of messages.
 * If the sender doesn't recieve a reply after this time,
 * the message is considered lost.
 */
export const MESSAGE_TIMEOUT = isRunningInTest() ? 3000 : 10000

/**
 * Execution timeout.
 * It is common courtesy that the receiver should reply with
 * a timeout after this time,
 * so that the sender doesn't consider the message lost.
 */
export const ACTION_TIMEOUT = MESSAGE_TIMEOUT - 1000
if (ACTION_TIMEOUT < 0) throw new Error('ACTION_TIMEOUT < 0')

/**
 * "Inner execution timeout"
 * To be used inside of actions, like when requesting an external resource or similar.
 * This allows the action to gracefully handle an external timeout, by not triggering the ACTION_TIMEOUT.
 */
export const INNER_ACTION_TIMEOUT = ACTION_TIMEOUT - 1000
if (INNER_ACTION_TIMEOUT < 0) throw new Error('INNER_ACTION_TIMEOUT < 0')

export abstract class WebsocketConnection extends HelpfulEventEmitter {
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
							error: `Error: Websocket message timeout: ${msg.type}, ${JSON.stringify(args)}`,
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

			try {
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
							error: stringifyError(error),
						}
						this.ws?.send(JSON.stringify(reply))
					})
			} catch (error) {
				const reply: MessageReply = {
					r: true,
					i: msg.i,
					error: 'Thrown Error: ' + stringifyError(error),
				}
				this.ws?.send(JSON.stringify(reply))
			}
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
export type MessageIdentifyClient =
	| MessageIdentifyClientNotAssigned
	| MessageIdentifyClientWorkerAgent
	| MessageIdentifyClientExpectationManager
	| MessageIdentifyClientAppContainer

export interface MessageIdentifyClientBase extends MessageBase {
	internalType: 'identify_client'
}
export interface MessageIdentifyClientNotAssigned extends MessageIdentifyClientBase {
	clientType: 'N/A'
	id: NotAssignedPartyId
}
export interface MessageIdentifyClientWorkerAgent extends MessageIdentifyClientBase {
	clientType: 'workerAgent'
	id: WorkerAgentId
}
export interface MessageIdentifyClientExpectationManager extends MessageIdentifyClientBase {
	clientType: 'expectationManager'
	id: ExpectationManagerId
}
export interface MessageIdentifyClientAppContainer extends MessageIdentifyClientBase {
	clientType: 'appContainer'
	id: AppContainerId
}
export function isMessageIdentifyClient(message: unknown): message is MessageIdentifyClient {
	return Boolean(typeof message === 'object' && message && (message as any).internalType === 'identify_client')
}

export type NotAssignedPartyId = ProtectedString<'NotAssigned', string>

/** Ids of any communicating parties */
export type PartyId = NotAssignedPartyId | WorkerAgentId | ExpectationManagerId | AppContainerId | WorkforceId

/** A Hook defines */
export type Hook<ServerMethods extends MethodsInterfaceBase, ClientMethods extends MethodsInterfaceBase> = (
	otherId: ServerMethods['id'],
	clientHook: Omit<ClientMethods, 'id'>
) => ServerMethods
