import {
	GenericAccessorHandle,
	PackageReadInfo,
	PackageReadStream,
	PutPackageHandler,
	SetupPackageContainerMonitorsResult,
	AccessorHandlerRunCronJobResult,
	AccessorHandlerCheckHandleReadResult,
	AccessorHandlerCheckHandleWriteResult,
	AccessorHandlerCheckPackageContainerWriteAccessResult,
	AccessorHandlerCheckPackageReadAccessResult,
	AccessorHandlerTryPackageReadResult,
	PackageOperation,
	AccessorHandlerCheckHandleBasicResult,
	AccessorConstructorProps,
} from './genericHandle'
import {
	Accessor,
	AccessorOnPackage,
	Expectation,
	PackageContainerExpectation,
	assertNever,
	Reason,
	MonitorId,
	rebaseUrl,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { fetchWithController, fetchWithTimeout } from './lib/fetch'
import FormData from 'form-data'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { defaultCheckHandleRead, defaultCheckHandleWrite } from './lib/lib'

/** Accessor handle for accessing files in a local folder */
export class HTTPAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'http'
	private content: {
		/** This is set when the class-instance is only going to be used for PackageContainer access.*/
		onlyContainerAccess?: boolean
		path?: string
	}
	private workOptions: Expectation.WorkOptions.RemoveDelay
	private accessor: AccessorOnPackage.HTTP

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.HTTP>) {
		super({
			...arg,
			type: HTTPAccessorHandle.type,
		})
		this.accessor = arg.accessor
		this.content = arg.content
		this.workOptions = arg.workOptions

		// Verify content data:
		if (!this.content.onlyContainerAccess) {
			if (!this._getFilePath()) throw new Error('Bad input data: neither content.path nor accessor.url are set!')
		}

		if (this.workOptions.removeDelay && typeof this.workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
	}
	static doYouSupportAccess(worker: BaseWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.HTTP
		return !accessor.networkId || worker.agentAPI.location.localNetworkIds.includes(accessor.networkId)
	}
	get packageName(): string {
		return this.path
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.HTTP) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `HTTP Accessor type is not HTTP ("${this.accessor.type}")!`,
				},
			}
		}
		// Note: For the HTTP-accessor, we allow this.accessor.baseUrl to be empty/falsy
		// (which means that the content path needs to be a full URL)

		if (!this.content.onlyContainerAccess) {
			if (!this.path)
				return {
					success: false,
					knownReason: true,
					reason: {
						user: `filePath not set`,
						tech: `filePath not set`,
					},
				}
		}

		return { success: true }
	}
	checkHandleRead(): AccessorHandlerCheckHandleReadResult {
		const defaultResult = defaultCheckHandleRead(this.accessor)
		if (defaultResult) return defaultResult
		return { success: true }
	}
	checkHandleWrite(): AccessorHandlerCheckHandleWriteResult {
		const defaultResult = defaultCheckHandleWrite(this.accessor)
		if (defaultResult) return defaultResult
		return { success: true }
	}
	async checkPackageReadAccess(): Promise<AccessorHandlerCheckPackageReadAccessResult> {
		const header = await this.fetchHeader()

		if (this.isBadHTTPResponseCode(header.status)) {
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Got error code ${header.status} when trying to fetch package`,
					tech: `Error when requesting url "${this.fullUrl}": [${header.status}]: ${header.statusText}`,
				},
			}
		}
		return { success: true }
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		// TODO: Do a HEAD request?
		// 204 or 404 is "not found"
		// Access-Control-Allow-Methods should contain GET
		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		// todo: how to check this?
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.HTTPFile> {
		const header = await this.fetchHeader()

		return this.convertHeadersToVersion(header.headers)
	}
	async removePackage(reason: string): Promise<void> {
		if (this.workOptions.removeDelay) {
			await this.delayPackageRemoval(this.workOptions.removeDelay)
			this.logOperation(
				`Remove package: Delay remove package "${this.packageName}", delay: ${this.workOptions.removeDelay} (${reason})`
			)
		} else {
			await this.removeMetadata()
			if (await this.deletePackageIfExists(this.fullUrl)) {
				this.logOperation(`Remove package: Removed file "${this.packageName}" (${reason})`)
			} else {
				this.logOperation(`Remove package: File already removed "${this.packageName}" (${reason})`)
			}
		}
	}
	async getPackageReadStream(): Promise<PackageReadStream> {
		const fetch = fetchWithController(this.fullUrl)
		const res = await fetch.response

		if (this.isBadHTTPResponseCode(res.status)) {
			throw new Error(
				`HTTP.getPackageReadStream: Bad response: [${res.status}]: ${res.statusText}, GET ${this.fullUrl}`
			)
		}

		return {
			readStream: res.body,
			cancel: () => {
				fetch.controller.abort()
			},
		}
	}
	async putPackageStream(_sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		throw new Error('HTTP.putPackageStream: Not supported')
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('HTTP.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		throw new Error('HTTP.putPackageInfo: Not supported')
	}
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		await this.clearPackageRemoval()
		return this.logWorkOperation(operationName, source, this.packageName)
	}
	async finalizePackage(operation: PackageOperation): Promise<void> {
		// do nothing
		operation.logDone()
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		return undefined
	}
	async updateMetadata(_metadata: Metadata): Promise<void> {
		// Not supported
	}
	async removeMetadata(): Promise<void> {
		// Not supported
	}

	async runCronJob(packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerRunCronJobResult> {
		let badReason: Reason | null = null
		const cronjobs = Object.keys(packageContainerExp.cronjobs) as (keyof PackageContainerExpectation['cronjobs'])[]
		for (const cronjob of cronjobs) {
			if (cronjob === 'interval') {
				// ignore
			} else if (cronjob === 'cleanup') {
				badReason = await this.removeDuePackages()
				const options = packageContainerExp.cronjobs[cronjob]
				badReason = await this.removeDuePackages()
				if (!badReason && options?.cleanFileAge) {
					// Not supported, since we aren't able to properly list all untracked files on a generic http-server
				}
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of cronjobs are handled:
				assertNever(cronjob)
			}
		}

		if (!badReason) return { success: true }
		else return { success: false, knownReason: false, reason: badReason }
	}
	async setupPackageContainerMonitors(
		packageContainerExp: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult> {
		const resultingMonitors: Record<MonitorId, MonitorInProgress> = {}
		const monitorIds = Object.keys(
			packageContainerExp.monitors
		) as (keyof PackageContainerExpectation['monitors'])[]
		for (const monitorIdStr of monitorIds) {
			if (monitorIdStr === 'packages') {
				// todo: implement monitors
				throw new Error('Not implemented yet')
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of monitors are handled:
				assertNever(monitorIdStr)
			}
		}

		return { success: true, monitors: resultingMonitors }
	}
	get fullUrl(): string {
		return rebaseUrl(this.baseUrl, this.path)
	}

	private get baseUrl(): string {
		return this.accessor.baseUrl ?? ''
	}
	get path(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this._getFilePath()
		if (!filePath) throw new Error(`HTTPAccessorHandle: path not set!`)
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
		const ttl = this.accessor.isImmutable
			? 1000 * 60 * 60 * 24 // 1 day
			: 1000 // a second

		if (this.accessor.useGETinsteadOfHEAD) {
			// The source does NOT support HEAD requests, send a GET instead and abort the response:
			return await this.worker.cacheData(
				this.type,
				`GET ${this.fullUrl}`,
				async () => {
					const r = fetchWithController(this.fullUrl, {
						method: 'GET',
					})
					const response = await r.response
					response.body.on('error', () => {
						// Swallow the error. Since we're aborting the request, we're not interested in the body anyway.
					})

					const headers: HTTPHeaders = {
						contentType: response.headers.get('content-type'),
						contentLength: response.headers.get('content-length'),
						lastModified: response.headers.get('last-modified'),
						etags: response.headers.get('etag'),
					}
					// We're not interested in the actual body, so abort the request:
					r.controller.abort()
					return {
						headers,
						status: response.status,
						statusText: response.statusText,
					}
				},
				ttl
			)
		} else {
			return await this.worker.cacheData(
				this.type,
				`HEAD ${this.fullUrl}`,
				async () => {
					const r = fetchWithController(this.fullUrl, {
						method: 'HEAD',
					})
					const response = await r.response
					response.body.on('error', (e) => {
						this.worker.logger.warn(`fetchHeader: Error ${e}`)
					})

					const headers: HTTPHeaders = {
						contentType: response.headers.get('content-type'),
						contentLength: response.headers.get('content-length'),
						lastModified: response.headers.get('last-modified'),
						etags: response.headers.get('etag'),
					}
					return {
						headers,
						status: response.status,
						statusText: response.statusText,
					}
				},
				ttl
			)
		}
	}

	async delayPackageRemoval(ttl: number): Promise<void> {
		const packagesToRemove = await this.getPackagesToRemove()

		const filePath = this.path

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

		const filePath = this.path

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
				const fullUrl: string = rebaseUrl(this.baseUrl, entry.filePath)

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
	/** Returns false if it doesn't exist */
	private async deletePackageIfExists(url: string): Promise<boolean> {
		const result = await fetchWithTimeout(url, {
			method: 'DELETE',
		})
		if (result.status === 404) return false // that's ok
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(
				`deletePackageIfExists: Bad response: [${result.status}]: ${result.statusText}, DELETE ${this.fullUrl}, ${text}`
			)
		}
		return true
	}
	/** Full path to the file containing deferred removals */
	private get deferRemovePackagesPath(): string {
		return rebaseUrl(this.baseUrl, '__removePackages.json')
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
		if (this.isBadHTTPResponseCode(result.status)) {
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
		if (this.isBadHTTPResponseCode(result.status)) {
			const text = await result.text()
			throw new Error(`storeJSON: Bad response: [${result.status}]: ${result.statusText}, POST ${url}, ${text}`)
		}
	}
	/** Full path to the metadata file */
	private getMetadataPath(fullUrl: string) {
		return fullUrl + '_metadata.json'
	}
	private _getFilePath(): string | undefined {
		return this.accessor.url || this.content.path
	}
	private isBadHTTPResponseCode(code: number) {
		return code >= 400
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
