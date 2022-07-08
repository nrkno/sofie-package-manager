import AbortController from 'abort-controller'
import fetch, { Response, RequestInit } from 'node-fetch'
import { INNER_ACTION_TIMEOUT } from '@sofie-package-manager/api'
import { Agent as HTTPAgent } from 'http'
import { Agent as HTTPSAgent } from 'https'
import { URL } from 'url'

const MAX_FREE_SOCKETS = 5
const MAX_SOCKETS_PER_HOST = 5
const MAX_ALL_SOCKETS = 25
const HTTP_TIMEOUT = 15 * 1000

const fetchHTTPAgent = new HTTPAgent({
	keepAlive: true,
	maxFreeSockets: MAX_FREE_SOCKETS,
	maxSockets: MAX_SOCKETS_PER_HOST,
	maxTotalSockets: MAX_ALL_SOCKETS,
	timeout: HTTP_TIMEOUT,
})

const fetchHTTPSAgent = new HTTPSAgent({
	keepAlive: true,
	maxFreeSockets: MAX_FREE_SOCKETS,
	maxSockets: MAX_SOCKETS_PER_HOST,
	maxTotalSockets: MAX_ALL_SOCKETS,
	timeout: HTTP_TIMEOUT,
})

export type FetchWithControllerOptions = Omit<RequestInit, 'signal'> & {
	/**
	 * If provided, will refresh the fetch abort timeout every time the 'data' event is fired.
	 * This is useful when uploading files, to avoid the timeout from firing.
	 */
	refreshStream?: NodeJS.ReadableStream
}

/**
 * Fetches a url using node-fetch and times out prudently
 * Note that this function does not support using an AbortController (use fetchWithController for that)
 */
export async function fetchWithTimeout(url: string, options?: Omit<RequestInit, 'signal'>): Promise<Response> {
	const o = fetchWithController(url, options)
	return o.response
}

function selectAgent(parsedUrl: URL) {
	if (parsedUrl.protocol === 'https:') {
		return fetchHTTPSAgent
	} else {
		return fetchHTTPAgent
	}
}

/**
 * Fetches a url using node-fetch and times out prudently.
 * Returns the response and the AbortController
 */
export function fetchWithController(
	url: string,
	options?: FetchWithControllerOptions
): { response: Promise<Response>; controller: AbortController } {
	const controller = new AbortController()

	// encode, to avoid issues with special characters such as åäöØÅÖÆÅ
	url = encodeURI(url)
	return {
		response: new Promise((resolve, reject) => {
			const refreshTimeout = () => {
				return setTimeout(() => {
					reject(
						new Error(
							`Timeout when fetching ${options?.method || ' '} "${url}" after ${INNER_ACTION_TIMEOUT}ms`
						)
					)

					// Don't leave the request hanging and possibly consume bandwidth:
					controller.abort()
				}, INNER_ACTION_TIMEOUT)
			}

			let timeout = refreshTimeout()
			if (options?.refreshStream) {
				options.refreshStream.on('data', () => {
					clearTimeout(timeout)
					timeout = refreshTimeout()
				})
			}

			const doTheFetch = async () =>
				fetch(url, { ...options, signal: controller.signal, agent: selectAgent }).then((response) => {
					// At this point, the headers have been received.

					// Clear the timeout:
					clearTimeout(timeout)
					resolve(response)
				})

			doTheFetch().catch((err) => {
				if (`${err}`.match(/connect EADDRINUSE/)) {
					// This means that a local port is already in use.
					// We should try again once as it often is a temporary issue:

					doTheFetch().catch((err) => {
						reject(err)
					})
				} else {
					reject(err)
				}
			})
		}),
		controller,
	}
}
