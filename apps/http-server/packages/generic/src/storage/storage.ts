import { Readable } from 'stream'
import { CTXPost } from '../lib'

export abstract class Storage {
	abstract init(): Promise<void>
	abstract getInfo(): string
	abstract listPackages(): Promise<
		| {
				sidecar: Sidecar
				body: {
					packages: PackageInfo[]
				}
		  }
		| BadResponse
	>
	abstract headPackage(path: string): Promise<{ sidecar: Sidecar } | BadResponse>
	abstract getPackage(path: string): Promise<{ sidecar: Sidecar; body: any } | BadResponse>
	abstract postPackage(
		path: string,
		ctx: CTXPost,
		fileStreamOrText: string | Readable | undefined
	): Promise<{ sidecar: Sidecar; body: any } | BadResponse>
	abstract deletePackage(path: string): Promise<{ sidecar: Sidecar; body: any } | BadResponse>
}
export interface BadResponse {
	code: number
	reason: string
}
export function isBadResponse(v: unknown): v is BadResponse {
	return (
		typeof v === 'object' &&
		typeof (v as BadResponse).code === 'number' &&
		typeof (v as BadResponse).reason === 'string'
	)
}

export type PackageInfo = {
	path: string
	size: string
	modified: string
}

export interface Sidecar {
	statusCode: number
	type?: string
	length?: number
	lastModified?: Date
	headers: {
		[key: string]: string
	}
}
