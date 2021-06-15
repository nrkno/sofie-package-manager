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
	private metadataPath: string

	constructor(
		worker: GenericWorker,
		public readonly accessorId: string,
		private accessor: AccessorOnPackage.FTP,
		content: any
	) {
		super(worker, accessorId, accessor, content, FTPAccessorHandle.type)

		// baseUrl needs to not be optional - is there a reason it can't be?
		if (!accessor.baseUrl) {
			throw new Error('no baseURL')
		}
		this.metadataPath = `${this.accessor.path}${METADATA_FILE_SUFFIX}`
		this.ftpClient = new Client()
		try {
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

	checkHandleRead(): AccessorHandlerResult {
		throw new Error('Method not implemented.')
	}
	checkHandleWrite(): AccessorHandlerResult {
		throw new Error('Method not implemented.')
	}
	checkPackageReadAccess(): Promise<AccessorHandlerResult> {
		throw new Error('Method not implemented.')
	}
	tryPackageRead(): Promise<AccessorHandlerResult> {
		throw new Error('Method not implemented.')
	}
	checkPackageContainerWriteAccess(): Promise<AccessorHandlerResult> {
		throw new Error('Method not implemented.')
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

	getPackageActualVersion(): Promise<Expectation.Version.Any> {
		throw new Error('Method not implemented.')
	}

	removePackage(): Promise<void> {
		throw new Error('Method not implemented.')
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}

		const stream = new Duplex()
		const response = await this.ftpClient.downloadTo(stream, this.metadataPath)
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
		const metadataString = JSON.stringify(metadata)
		const metadataStream = Readable.from(metadataString)

		const response = await this.ftpClient.uploadFrom(metadataStream, this.metadataPath)
		checkFtpResponse(response)
	}

	async removeMetadata(): Promise<void> {
		const response = await this.ftpClient.remove(this.metadataPath, true)
		checkFtpResponse(response)
	}

	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		// set up a stream for the FTP resource here
		if (this.ftpClient.closed) {
			await this.ftpClient.access(this.clientOptions)
		}
		const writeStream = new Duplex()

		const response = await this.ftpClient.downloadTo(writeStream, this.accessor.path)
		checkFtpResponse(response)

		return {
			readStream: writeStream,
			cancel: () => {
				// todo: Abort?
				// response.
			},
		}
	}
	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		const readable = new Readable(sourceStream)

		const handler = new PutPackageHandler(() => {
			readable.destroy()
		})

		try {
			const response = await this.ftpClient.uploadFrom(readable, this.accessor.path)
			checkFtpResponse(response)
			handler.emit('close')
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
