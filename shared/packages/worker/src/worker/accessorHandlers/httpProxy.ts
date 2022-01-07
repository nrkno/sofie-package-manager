import {
	GenericAccessorHandle,
	PackageReadInfo,
	PackageReadStream,
	PutPackageHandler,
	AccessorHandlerResult,
	SetupPackageContainerMonitorsResult,
} from './genericHandle'
import { Accessor, AccessorOnPackage, Expectation, PackageContainerExpectation, assertNever, Reason } from '@shared/api'
import { GenericWorker } from '../worker'
import FormData from 'form-data'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { fetchWithController, fetchWithTimeout } from './lib/fetch'

/** Accessor handle for accessing files in HTTP- */
export class HTTPProxyAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'http-proxy'
	private content: {
		/** This is set when the class-instance is only going to be used for PackageContainer access.*/
		onlyContainerAccess?: boolean
		filePath?: string
	}
	private workOptions: Expectation.WorkOptions.RemoveDelay
	constructor(
		worker: GenericWorker,
		public readonly accessorId: string,
		private accessor: AccessorOnPackage.HTTPProxy,
		content: any, // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
		workOptions: any // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
	) {
		super(worker, accessorId, accessor, content, HTTPProxyAccessorHandle.type)

		// Verify content data:
		if (!content.onlyContainerAccess) {
			if (!content.filePath) throw new Error('Bad input data: content.filePath not set!')
		}
		this.content = content

		if (workOptions.removeDelay && typeof workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
		this.workOptions = workOptions
	}
	static doYouSupportAccess(worker: GenericWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.HTTP
		return !accessor.networkId || worker.location.localNetworkIds.includes(accessor.networkId)
	}
	checkHandleRead(): AccessorHandlerResult {
		if (!this.accessor.allowRead) {
			return {
				success: false,
				reason: {
					user: `Not allowed to read`,
					tech: `Not allowed to read`,
				},
			}
		}
		return this.checkAccessor()
	}
	checkHandleWrite(): AccessorHandlerResult {
		if (!this.accessor.allowWrite) {
			return {
				success: false,
				reason: {
					user: `Not allowed to write`,
					tech: `Not allowed to write`,
				},
			}
		}
		return this.checkAccessor()
	}
	async checkPackageReadAccess(): Promise<AccessorHandlerResult> {
		const header = await this.fetchHeader()

		if (header.status >= 400) {
			return {
				success: false,
				reason: {
					user: `Got error code ${header.status} when trying to fetch package`,
					tech: `Error when requesting url "${this.fullUrl}": [${header.status}]: ${header.statusText}`,
				},
			}
		}
		return { success: true }
	}
	async tryPackageRead(): Promise<AccessorHandlerResult> {
		// TODO: how to do this?
		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerResult> {
		// todo: how to check this?
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.HTTPFile> {
		const header = await this.fetchHeader()

		return this.convertHeadersToVersion(header.headers)
	}
	async removePackage(): Promise<void> {
		if (this.workOptions.removeDelay) {
			await this.delayPackageRemoval(this.workOptions.removeDelay)
		} else {
			await this.removeMetadata()
			await this.deletePackageIfExists(this.fullUrl)
		}
	}
	async getPackageReadStream(): Promise<PackageReadStream> {
		const fetch = fetchWithController(this.fullUrl)
		const res = await fetch.response

		return {
			readStream: res.body,
			cancel: () => {
				fetch.controller.abort()
			},
		}
	}
	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		await this.clearPackageRemoval()

		const formData = new FormData()
		formData.append('file', sourceStream)

		const fetch = fetchWithController(this.fullUrl, {
			method: 'POST',
			body: formData,
			refreshStream: sourceStream, // pass in the source stream to avoid the featch-timeout to fire
		})
		const streamHandler: PutPackageHandler = new PutPackageHandler(() => {
			fetch.controller.abort()
		})

		fetch.response
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
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('HTTP.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		throw new Error('HTTP.putPackageInfo: Not supported')
	}
	async finalizePackage(): Promise<void> {
		// do nothing
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		return this.fetchJSON(this.getMetadataPath(this.fullUrl))
	}
	async updateMetadata(metadata: Metadata): Promise<void> {
		await this.storeJSON(this.getMetadataPath(this.fullUrl), metadata)
	}
	async removeMetadata(): Promise<void> {
		await this.deletePackageIfExists(this.getMetadataPath(this.fullUrl))
	}

	async runCronJob(packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerResult> {
		let badReason: Reason | null = null
		const cronjobs = Object.keys(packageContainerExp.cronjobs) as (keyof PackageContainerExpectation['cronjobs'])[]
		for (const cronjob of cronjobs) {
			if (cronjob === 'interval') {
				// ignore
			} else if (cronjob === 'cleanup') {
				badReason = await this.removeDuePackages()
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of cronjobs are handled:
				assertNever(cronjob)
			}
		}

		if (!badReason) return { success: true }
		else return { success: false, reason: badReason }
	}
	async setupPackageContainerMonitors(
		packageContainerExp: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult> {
		const resultingMonitors: { [monitorId: string]: MonitorInProgress } = {}
		const monitorIds = Object.keys(
			packageContainerExp.monitors
		) as (keyof PackageContainerExpectation['monitors'])[]
		for (const monitorId of monitorIds) {
			if (monitorId === 'packages') {
				// todo: implement monitors
				throw new Error('Not implemented yet')
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of monitors are handled:
				assertNever(monitorId)
			}
		}

		return { success: true, monitors: resultingMonitors }
	}
	get fullUrl(): string {
		return [
			this.baseUrl.replace(/\/$/, ''), // trim trailing slash
			this.filePath.replace(/^\//, ''), // trim leading slash
		].join('/')
	}

	private checkAccessor(): AccessorHandlerResult {
		if (this.accessor.type !== Accessor.AccessType.HTTP_PROXY) {
			return {
				success: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `HTTPProxy Accessor type is not HTTP_PROXY ("${this.accessor.type}")!`,
				},
			}
		}
		if (!this.accessor.baseUrl)
			return {
				success: false,
				reason: {
					user: `Accessor baseUrl not set`,
					tech: `Accessor baseUrl not set`,
				},
			}
		if (!this.content.onlyContainerAccess) {
			if (!this.filePath)
				return {
					success: false,
					reason: {
						user: `filePath not set`,
						tech: `filePath not set`,
					},
				}
		}
		return { success: true }
	}
	private get baseUrl(): string {
		if (!this.accessor.baseUrl) throw new Error(`HTTPAccessorHandle: accessor.baseUrl not set!`)
		return this.accessor.baseUrl
	}
	get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this.accessor.url || this.content.filePath
		if (!filePath) throw new Error(`HTTPAccessorHandle: filePath not set!`)
		return filePath
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
		const fetch = fetchWithController(this.fullUrl)
		const res = await fetch.response

		res.body.on('error', () => {
			// Swallow the error. Since we're aborting the request, we're not interested in the body anyway.
		})

		const headers: HTTPHeaders = {
			contentType: res.headers.get('content-type'),
			contentLength: res.headers.get('content-length'),
			lastModified: res.headers.get('last-modified'),
			etags: res.headers.get('etag'),
		}
		// We've got the headers, abort the call so we don't have to download the whole file:
		fetch.controller.abort()

		return {
			status: res.status,
			statusText: res.statusText,
			headers: headers,
		}
	}

	async delayPackageRemoval(ttl: number): Promise<void> {
		const packagesToRemove = await this.getPackagesToRemove()

		const filePath = this.filePath

		// Search for a pre-existing entry:
		let found = false
		for (const entry of packagesToRemove) {
			if (entry.filePath === filePath) {
				// extend the TTL if it was found:
				entry.removeTime = Date.now() + ttl

				found = true
				break
			}
		}
		if (!found) {
			packagesToRemove.push({
				filePath: filePath,
				removeTime: Date.now() + ttl,
			})
		}

		await this.storePackagesToRemove(packagesToRemove)
	}
	/** Clear a scheduled later removal of a package */
	async clearPackageRemoval(): Promise<void> {
		const packagesToRemove = await this.getPackagesToRemove()

		const filePath = this.filePath

		let found = false
		for (let i = 0; i < packagesToRemove.length; i++) {
			const entry = packagesToRemove[i]
			if (entry.filePath === filePath) {
				packagesToRemove.splice(i, 1)
				found = true
				break
			}
		}
		if (found) {
			await this.storePackagesToRemove(packagesToRemove)
		}
	}
	/** Remove any packages that are due for removal */
	async removeDuePackages(): Promise<Reason | null> {
		let packagesToRemove = await this.getPackagesToRemove()

		const removedFilePaths: string[] = []
		for (const entry of packagesToRemove) {
			// Check if it is time to remove the package:
			if (entry.removeTime < Date.now()) {
				// it is time to remove the package:
				const fullUrl: string = [
					this.baseUrl.replace(/\/$/, ''), // trim trailing slash
					entry.filePath,
				].join('/')

				await this.deletePackageIfExists(this.getMetadataPath(fullUrl))
				await this.deletePackageIfExists(fullUrl)
				removedFilePaths.push(entry.filePath)
			}
		}

		// Fetch again, to decrease the risk of race-conditions:
		packagesToRemove = await this.getPackagesToRemove()
		let changed = false
		// Remove paths from array:
		for (let i = 0; i < packagesToRemove.length; i++) {
			const entry = packagesToRemove[i]
			if (removedFilePaths.includes(entry.filePath)) {
				packagesToRemove.splice(i, 1)
				changed = true
				break
			}
		}
		if (changed) {
			await this.storePackagesToRemove(packagesToRemove)
		}
		return null
	}
	private async deletePackageIfExists(url: string): Promise<void> {
		const result = await fetchWithTimeout(url, {
			method: 'DELETE',
		})
		if (result.status === 404) return undefined // that's ok
		if (result.status >= 400) {
			const text = await result.text()
			throw new Error(
				`deletePackageIfExists: Bad response: [${result.status}]: ${result.statusText}, DELETE ${this.fullUrl}, ${text}`
			)
		}
	}
	/** Full path to the file containing deferred removals */
	private get deferRemovePackagesPath(): string {
		return [
			this.baseUrl.replace(/\/$/, ''), // trim trailing slash
			'__removePackages.json',
		].join('/')
	}
	/** */
	private async getPackagesToRemove(): Promise<DelayPackageRemovalEntry[]> {
		return (await this.fetchJSON(this.deferRemovePackagesPath)) ?? []
	}
	private async storePackagesToRemove(packagesToRemove: DelayPackageRemovalEntry[]): Promise<void> {
		await this.storeJSON(this.deferRemovePackagesPath, packagesToRemove)
	}
	private async fetchJSON(url: string): Promise<any | undefined> {
		const result = await fetchWithTimeout(url)
		if (result.status === 404) return undefined
		if (result.status >= 400) {
			const text = await result.text()
			throw new Error(
				`getPackagesToRemove: Bad response: [${result.status}]: ${result.statusText}, GET ${url}, ${text}`
			)
		}
		return result.json()
	}
	private async storeJSON(url: string, data: any): Promise<void> {
		const formData = new FormData()
		formData.append('text', JSON.stringify(data))
		const result = await fetchWithTimeout(url, {
			method: 'POST',
			body: formData,
		})
		if (result.status >= 400) {
			const text = await result.text()
			throw new Error(`storeJSON: Bad response: [${result.status}]: ${result.statusText}, POST ${url}, ${text}`)
		}
	}
	/** Full path to the metadata file */
	private getMetadataPath(fullUrl: string) {
		return fullUrl + '_metadata.json'
	}
}
interface HTTPHeaders {
	contentType: string | null
	contentLength: string | null
	lastModified: string | null
	etags: string | null
}

interface DelayPackageRemovalEntry {
	/** Local file path */
	filePath: string
	/** Unix timestamp for when it's clear to remove the file */
	removeTime: number
}
