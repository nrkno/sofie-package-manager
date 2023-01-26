import { Readable } from 'stream'
import { CTX, CTXPost } from '../lib'

export abstract class Storage {
	abstract init(): Promise<void>
	abstract getInfo(): string
	abstract listPackages(ctx: CTX): Promise<true | BadResponse>
	abstract headPackage(path: string, ctx: CTX): Promise<true | BadResponse>
	abstract getPackage(path: string, ctx: CTX): Promise<true | BadResponse>
	abstract postPackage(
		path: string,
		ctx: CTXPost,
		fileStreamOrText: string | Readable | undefined
	): Promise<true | BadResponse>
	abstract deletePackage(path: string, ctx: CTXPost): Promise<true | BadResponse>
}
export interface BadResponse {
	code: number
	reason: string
}
