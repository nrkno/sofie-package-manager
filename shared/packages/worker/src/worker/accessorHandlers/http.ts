import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle, PackageWriteStreamWrapper } from './genericHandle'
import { Expectation } from '@shared/api'
import { GenericWorker } from '../worker'
import fetch from 'node-fetch'
import * as FormData from 'form-data'
import AbortController from 'abort-controller'

/** Accessor handle for accessing files in a local folder */
export class HTTPAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	constructor(
		worker: GenericWorker,
		private accessor: AccessorOnPackage.HTTP,
		private content: {
			filePath: string
		}
	) {
		super(worker, accessor, content, 'http')
	}
	doYouSupportAccess(): boolean {
		return !this.accessor.networkId || this.worker.location.localNetworkIds.includes(this.accessor.networkId)
	}
	checkHandleRead(): string | undefined {
		if (!this.accessor.allowRead) {
			return `Not allowed to read`
		}
		return this.checkAccessor()
	}
	checkHandleWrite(): string | undefined {
		if (!this.accessor.allowWrite) {
			return `Not allowed to write`
		}
		return this.checkAccessor()
	}
	private checkAccessor(): string | undefined {
		if (this.accessor.type !== Accessor.AccessType.HTTP) {
			return `HTTP Accessor type is not HTTP ("${this.accessor.type}")!`
		}
		if (!this.accessor.baseUrl) return `Accessor baseUrl not set`
		if (!this.filePath) return `filePath not set`
		return undefined // all good
	}
	async checkPackageReadAccess(): Promise<string | undefined> {
		const header = await this.fetchHeader()

		if (header.status >= 400) {
			return `Error when requesting url "${this.fullUrl}": [${header.status}]: ${header.statusText}`
		}
		return undefined // all good
	}
	async tryPackageRead(): Promise<string | undefined> {
		// TODO: how to do this?
		return undefined
	}
	async checkPackageContainerWriteAccess(): Promise<string | undefined> {
		// todo: how to check this?
		return undefined // all good
	}
	async getPackageActualVersion(): Promise<Expectation.Version.HTTPFile> {
		const header = await this.fetchHeader()

		return this.convertHeadersToVersion(header.headers)
	}
	async removePackage(): Promise<void> {
		// TODO: send DELETE request
	}

	get baseUrl(): string {
		if (!this.accessor.baseUrl) throw new Error(`HTTPAccessorHandle: accessor.baseUrl not set!`)
		return this.accessor.baseUrl
	}
	get filePath(): string {
		const filePath = this.accessor.url || this.content.filePath
		if (!filePath) throw new Error(`HTTPAccessorHandle: filePath not set!`)
		return filePath
	}
	get fullUrl(): string {
		return [
			this.baseUrl.replace(/\/$/, ''), // trim trailing slash
			this.filePath.replace(/^\//, ''), // trim leading slash
		].join('/')
	}
	private convertHeadersToVersion(headers: HTTPHeaders): Expectation.Version.HTTPFile {
		return {
			type: Expectation.Version.Type.HTTP_FILE,

			contentType: headers.contentType || '',
			contentLength: parseInt(headers.contentLength || '0', 10) || 0,
			modified: headers.lastModified ? new Date(headers.lastModified).getTime() : 0,
			etags: [], // headers.etags, // todo!
		}
	}
	private async fetchHeader() {
		const controller = new AbortController()
		const res = await fetch(this.fullUrl, { signal: controller.signal })

		const headers: HTTPHeaders = {
			contentType: res.headers.get('content-type'),
			contentLength: res.headers.get('content-length'),
			lastModified: res.headers.get('last-modified'),
			etags: res.headers.get('etag'),
		}
		// We've got the headers, abort the call so we don't have to download the whole file:
		controller.abort()

		return {
			status: res.status,
			statusText: res.statusText,
			headers: headers,
		}
	}
	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		const controller = new AbortController()
		const res = await fetch(this.fullUrl, { signal: controller.signal })

		return {
			readStream: res.body,
			cancel: () => {
				controller.abort()
			},
		}
	}
	async pipePackageStream(sourceStream: NodeJS.ReadableStream): Promise<PackageWriteStreamWrapper> {
		const formData = new FormData()
		formData.append('file', sourceStream)

		const controller = new AbortController()

		const streamHandler: PackageWriteStreamWrapper = new PackageWriteStreamWrapper(() => {
			controller.abort()
		})

		fetch(this.fullUrl, {
			method: 'POST',
			body: formData, // sourceStream.readStream,
			signal: controller.signal,
		})
			.then((result) => {
				if (result.status >= 400) {
					throw new Error(
						`Upload file: Bad response: [${result.status}]: ${result.statusText} POST "${this.fullUrl}"`
					)
				}
			})
			.then(() => {
				streamHandler.emit('close')
			})
			.catch((error) => {
				streamHandler.emit('error', error)
			})

		return streamHandler
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		const url = this.fullUrl + '_metadata.json'
		const result = await fetch(url)
		if (result.status === 404) return undefined
		if (result.status >= 400) {
			const text = await result.text()
			throw new Error(
				`fetchMetadata: Bad response: [${result.status}]: ${result.statusText}, GET ${url}, ${text}`
			)
		}

		return result.json()
	}
	async updateMetadata(metadata: Metadata): Promise<void> {
		const formData = new FormData()
		formData.append('text', JSON.stringify(metadata))
		const url = this.fullUrl + '_metadata.json'
		const result = await fetch(url, {
			method: 'POST',
			body: formData,
		})
		if (result.status >= 400) {
			const text = await result.text()
			throw new Error(
				`updateMetadata: Bad response: [${result.status}]: ${result.statusText}, POST ${url}, ${text}`
			)
		}
	}
	async removeMetadata(): Promise<void> {
		const url = this.fullUrl + '_metadata.json'
		const result = await fetch(url, {
			method: 'DELETE',
		})
		if (result.status === 404) return undefined // that's ok
		if (result.status >= 400) {
			const text = await result.text()
			throw new Error(
				`removeMetadata: Bad response: [${result.status}]: ${result.statusText}, DELETE ${url}, ${text}`
			)
		}
	}
}
interface HTTPHeaders {
	contentType: string | null
	contentLength: string | null
	lastModified: string | null
	etags: string | null
}
