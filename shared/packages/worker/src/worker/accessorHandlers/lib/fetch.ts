import AbortController from 'abort-controller'
import fetch, { Response, RequestInit } from 'node-fetch'
import { INNER_ACTION_TIMEOUT } from '@shared/api'

/**
 * Fetches a url using node-fetch and times out prudently
 * Note that this function does not support using an AbortController (use fetchWithController for that)
 */
export function fetchWithTimeout(url: string, options?: Omit<RequestInit, 'signal'>): Promise<Response> {
	const o = fetchWithController(url, options)
	return o.response
}
/**
 * Fetches a url using node-fetch and times out prudently.
 * Returns the response and the AbortController
 */
export function fetchWithController(
	url: string,
	options?: Omit<RequestInit, 'signal'>
): { response: Promise<Response>; controller: AbortController } {
	const controller = new AbortController()
	return {
		response: new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Timeout when fetching "${url}"`))

				// Don't leave the request hanging and possibly consume bandwidth:
				controller.abort()
			}, INNER_ACTION_TIMEOUT)

			fetch(url, { ...options, signal: controller.signal })
				.then((response) => {
					// At this point, the headers have been received.

					// Clear the timeout:
					clearTimeout(timeout)
					resolve(response)
				})
				.catch((err) => {
					reject(err)
				})
		}),
		controller,
	}
}
