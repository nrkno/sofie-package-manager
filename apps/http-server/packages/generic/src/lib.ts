import Koa from 'koa'
import Router from 'koa-router'
import { Readable, Writable } from 'stream'

export type CTX = Koa.ParameterizedContext<any, Router.IRouterParamContext<any, any>>
export type CTXPost = Koa.ParameterizedContext<any, Router.IRouterParamContext<any, any>>

export async function asyncPipe(readable: Readable, writable: Writable): Promise<void> {
	return new Promise((resolve) => {
		readable.pipe(writable)
		readable.on('end', () => {
			resolve()
		})
	})
}

export function valueOrFirst(text: string | string[] | undefined): string | undefined {
	if (!text) {
		return undefined
	} else if (Array.isArray(text)) {
		return text[0]
	} else {
		return text
	}
}

/**
 * The version of the package.json file
 * Note: This variable is updated at build-time by scripts/prebuild.js
 */
export const PACKAGE_JSON_VERSION = '1.50.6'
