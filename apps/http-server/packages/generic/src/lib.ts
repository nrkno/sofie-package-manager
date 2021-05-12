import Koa from 'koa'
import Router from 'koa-router'

export type CTX = Koa.ParameterizedContext<any, Router.IRouterParamContext<any, any>>
export type CTXPost = Koa.ParameterizedContext<any, Router.IRouterParamContext<any, any>>
