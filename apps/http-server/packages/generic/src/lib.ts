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
