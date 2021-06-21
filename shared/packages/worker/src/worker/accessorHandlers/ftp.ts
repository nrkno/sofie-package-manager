import { AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import {
	AccessorHandlerResult,
	GenericAccessorHandle,
	PackageReadInfoQuantelClip,
	PackageReadInfoWrap,
	PutPackageHandler,
} from './genericHandle'
import { Expectation, PackageContainerExpectation } from '@shared/api'
import { GenericWorker } from '../worker'
import { Client, AccessOptions, FTPResponse } from 'basic-ftp'
import { URL } from 'url'
import { Readable, Duplex } from 'stream'

const METADATA_FILE_SUFFIX = '_metadata.json'

/** Accessor handle for accessing files on a FTP server */
export class FTPAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'ftp'
	private ftpClient: Client
	private clientOptions: AccessOptions

	private content: {
		/** This is set when the class-instance is only going to be used for PackageContainer access.*/
		onlyContainerAccess?: boolean
		filePath?: string
	}

	constructor(
		worker: GenericWorker,
		public readonly accessorId: string,
		private accessor: AccessorOnPackage.FTP,
		content: any //TODO: what can be expected here?
	) {
		super(worker, accessorId, accessor, content, FTPAccessorHandle.type)

		// Verify content data:
		if (!content.onlyContainerAccess) {
			if (!content.filePath) throw new Error('Bad input data: content.filePath not set!')
		}
		this.content = content

		this.ftpClient = new Client()
		try {
			if (!accessor.baseUrl) {
				throw new Error('FTP server base URL missing')
			}
			const serverUrl = new URL(accessor.baseUrl)
			this.clientOptions = {
				host: serverUrl.hostname,
				user: accessor.userName,
				password: accessor.password,
				secure: accessor.requireTLS === true ? true : 'implicit',
				port: Number(serverUrl.port),
			}
		} catch (err) {
			throw new Error(`Failed to create FTP accessor handle: ${err.message}`)
		}
	}

	//TODO: just resolve these to private properties in the constructor? Is there
	// any reason to think the necessary data would not be available at object
	// create time or any reason the data should (be allowed to) change through
	// the lifetime of the object?

	/**
	 * Figures out which path to use for the file, either from the supplied package
	 * content data (first priority) or using the path from the accessor (second).
	 *
	 * @returns the prioritized path to this package's file
	 */
	private getFilePath(): string {
		return this.content?.filePath || this.accessor.path
	}

	/**
	 * Constructs the metadata file path.
	 *
	 * @returns the path to the metadata file
	 */
	private getMetadataFilePath(): string {
		return `${this.getFilePath()}${METADATA_FILE_SUFFIX}`
	}

	checkHandleRead(): AccessorHandlerResult {
		if (!this.accessor.allowRead) {
			return {
				success: false,
				reason: { user: `Not allowed to read`, tech: `Not allowed to read (accessor.allowRead says no)` },
			}
		}

		return this.checkAccessor()
	}

	checkHandleWrite(): AccessorHandlerResult {
		if (!this.accessor.allowWrite) {
			return {
				success: false,
				reason: { user: `Not allowed to write`, tech: `Not allowed to write (accessor.allowWrite says no)` },
			}
		}

		return this.checkAccessor()
	}

	/**
	 * Checks the base URL and resource path for validity and creates a result
	 * with appropriate error messages if problems are found.
	 */
	private checkAccessor(): AccessorHandlerResult {
		if (!this.accessor.baseUrl) {
			return {
				success: false,
				reason: { user: 'FTP resource base URL is missing, check settings', tech: 'baseUrl not set' },
			}
		}

		const urlCheckResult = checkFtpUrl(this.accessor.baseUrl)
		if (!urlCheckResult.success) {
			return urlCheckResult
		}

		const pathCheckResults = checkFtpResourcePath(this.getFilePath())
		if (!pathCheckResults.success) {
			return pathCheckResults
		}

		return { success: true }
	}

	async checkPackageReadAccess(): Promise<AccessorHandlerResult> {
		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}

		try {
			const fileSize = await this.ftpClient.size(this.getFilePath())
			if (fileSize < 1) {
				return {
					success: false,
					reason: {
						user: `File has no content`,
						tech: `No content in file, server reported size of ${fileSize} bytes`,
					},
				}
			}
		} catch (err) {
			const errMsg =
				err.name === 'FTPError'
					? `Read failed [FTPError]: ${err.code} - ${err.message}`
					: `Read failed [${err.name}]: ${err.message}`

			return {
				success: false,
				reason: {
					user: 'Unable to read file from server',
					tech: errMsg,
				},
			}
		}

		return { success: true }
	}

	tryPackageRead(): Promise<AccessorHandlerResult> {
		// I don't think there's a universal way of checking if we can read without actually
		// initiating a transfer. Since checking for read access at least does a check on the
		// file size, this is probably the best we can do. Might be redundant?
		return this.checkPackageReadAccess()
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerResult> {
		// could theoretically write a one byte file to test, but some FTP servers disallows delete/overwrite
		// so just assume for now
		return { success: true }
	}

	putPackageInfo(_readInfo: PackageReadInfoQuantelClip): Promise<PutPackageHandler> {
		throw new Error('Method not implemented.')
	}
	finalizePackage(): Promise<void> {
		throw new Error('Method not implemented.')
	}
	runCronJob(_packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerResult> {
		throw new Error('Method not implemented.')
	}
	setupPackageContainerMonitors(_packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerResult> {
		throw new Error('Method not implemented.')
	}
	disposePackageContainerMonitors(_packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerResult> {
		throw new Error('Method not implemented.')
	}

	async getPackageActualVersion(): Promise<Expectation.Version.Any> {
		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}
		const fileSize = await this.ftpClient.size(this.getFilePath())
		let modified
		try {
			modified = (await this.ftpClient.lastMod(this.getFilePath())).getTime()
		} catch (err) {
			modified = 0
			// or Date.now(), or could that throw something in a weird loop where every
			// time a version is checked something thinks that a new version is available
			// and will download it?
		}
		return {
			type: Expectation.Version.Type.FTP_FILE,
			fileSize,
			modified,
		}
	}

	async removePackage(): Promise<void> {
		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}
		const response = await this.ftpClient.remove(this.getFilePath(), true)
		checkFtpResponse(response)

		await this.removeMetadata()
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}

		const stream = new Duplex()
		const response = await this.ftpClient.downloadTo(stream, this.getMetadataFilePath())
		checkFtpResponse(response)

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(Buffer.from(chunk)) // works with both text and binary content alike
		}

		const buffer = Buffer.concat(chunks)
		const str = buffer.toString('utf-8')
		return JSON.parse(str)
	}

	async updateMetadata(metadata: Metadata): Promise<void> {
		const readable = Readable.from(JSON.stringify(metadata))

		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}
		const response = await this.ftpClient.uploadFrom(readable, this.getMetadataFilePath())
		checkFtpResponse(response)
	}

	async removeMetadata(): Promise<void> {
		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}
		const response = await this.ftpClient.remove(this.getMetadataFilePath(), true)
		checkFtpResponse(response)
	}

	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		const writeStream = new Duplex()

		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}
		const response = await this.ftpClient.downloadTo(writeStream, this.getFilePath())
		checkFtpResponse(response)

		return {
			readStream: writeStream,
			cancel: () => {
				writeStream.destroy() // not sure how the ftp lib will react to his
			},
		}
	}
	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		const readable = new Readable(sourceStream)

		const handler = new PutPackageHandler(() => {
			readable.destroy()
		})

		try {
			if (this.ftpClient.closed) {
				await this.ftpClient.access(this.clientOptions)
			}
			const response = await this.ftpClient.uploadFrom(readable, this.getFilePath())
			checkFtpResponse(response)

			readable.on('end', () => {
				handler.emit('close')
			})
		} catch (err) {
			handler.emit('error', err)
		}

		return handler
	}

	getPackageReadInfo(): Promise<PackageReadInfoWrap> {
		throw new Error('Method not implemented.')
	}
}

/**
 * Checks an FTPResponse and throws errors if there's a problem
 *
 * @param response {FTPResponse} - the response to check
 * @throws {Error} - if the response indicates a problem
 */
function checkFtpResponse(response: FTPResponse): void {
	// should check response code, see https://en.wikipedia.org/wiki/List_of_FTP_server_return_codes
	// for now, just assume anything under 400 to be fine
	if (response.code >= 400) {
		throw new Error(`FTP error ${response.code}: ${response.message}`)
	}
}

/**
 * Utility function to validate an FTP URL string. Returns an
 * AccessorHandlerResult for convenience and more precise error message.
 *
 * @param urlString {string} - the URL as a string
 */
function checkFtpUrl(urlString: string): AccessorHandlerResult {
	try {
		const url = new URL(urlString)
		if (!['ftp:', 'ftps:'].includes(url.protocol)) {
			return {
				success: false,
				reason: {
					user: `${urlString} is not a valid FTP URL`,
					tech: `Invalid protocol ${url.protocol} for FTP transfer`,
				},
			}
		}
	} catch (err) {
		const message = `${urlString} is not a valid URL`
		return {
			success: false,
			reason: {
				user: message,
				tech: message,
			},
		}
	}

	return {
		success: true,
	}
}

function checkFtpResourcePath(path: string): AccessorHandlerResult {
	if (!path) {
		const message = 'No path given for FTP resource'
		return {
			success: false,
			reason: {
				user: message,
				tech: message,
			},
		}
	}

	try {
		new URL(`ftp://example.com${path}`)
	} catch (err) {
		const message = `Invalid path to resource ${path}`
		return {
			success: false,
			reason: {
				user: message,
				tech: message,
			},
		}
	}

	return { success: true }
}
