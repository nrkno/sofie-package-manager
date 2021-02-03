import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle, PackageWriteStreamWrapper } from './genericHandle'
import { Expectation } from '@shared/api'
import { GenericWorker } from '../worker'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)

/** Accessor handle for accessing files in a local folder */
export class LocalFolderAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	constructor(
		worker: GenericWorker,
		private accessor: AccessorOnPackage.LocalFolder,
		private content: {
			filePath: string
		}
	) {
		super(worker, accessor, content, 'localFolder')
	}
	doYouSupportAccess(): boolean {
		return !this.accessor.resourceId || this.accessor.resourceId === this.worker.location.localComputerId
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
		if (this.accessor.type !== Accessor.AccessType.LOCAL_FOLDER) {
			return `LocalFolder Accessor type is not LOCAL_FOLDER ("${this.accessor.type}")!`
		}
		if (!this.accessor.folderPath) return `Folder path not set`
		if (!this.filePath) return `File path not set`
		return undefined // all good
	}
	async checkPackageReadAccess(): Promise<string | undefined> {
		try {
			await fsAccess(this.fullPath, fs.constants.R_OK)
			// The file exists
		} catch (err) {
			// File is not readable
			return `Not able to read file: ${err.toString()}`
		}
		return undefined // all good
	}
	async checkPackageContainerWriteAccess(): Promise<string | undefined> {
		try {
			await fsAccess(this.folderPath, fs.constants.W_OK)
			// The file exists
		} catch (err) {
			// File is not readable
			return `Not able to write to file: ${err.toString()}`
		}
		return undefined // all good
	}
	async getPackageActualVersion(): Promise<Expectation.Version.MediaFile> {
		const stat = await fsStat(this.fullPath)
		return this.convertStatToVersion(stat)
	}
	async removePackage(): Promise<void> {
		await this.unlinkIfExists(this.fullPath)
	}

	get folderPath(): string {
		if (!this.accessor.folderPath) throw new Error(`LocalFolderAccessor: accessor.folderPath not set!`)
		return this.accessor.folderPath
	}
	get filePath(): string {
		const filePath = this.accessor.filePath || this.content.filePath
		if (!filePath) throw new Error(`LocalFolderAccessor: filePath not set!`)
		return filePath
	}
	get fullPath(): string {
		return path.join(this.folderPath, this.filePath)
	}
	private convertStatToVersion(stat: fs.Stats): Expectation.Version.MediaFile {
		return {
			type: Expectation.Version.Type.MEDIA_FILE,
			fileSize: stat.size,
			modifiedDate: stat.mtimeMs * 1000,
			// checksum?: string
			// checkSumType?: 'sha' | 'md5' | 'whatever'
		}
	}
	private async unlinkIfExists(path: string): Promise<void> {
		let exists = false
		try {
			await fsAccess(path, fs.constants.R_OK)
			// The file exists
			exists = true
		} catch (err) {
			// Ignore
		}
		if (exists) await fsUnlink(path)
	}

	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		const readStream = await new Promise<fs.ReadStream>((resolve, reject) => {
			const readStream = fs.createReadStream(this.fullPath)
			readStream.once('error', reject)
			// Wait for the stream to be actually valid before continuing:
			readStream.once('open', () => resolve(readStream))
		})

		return {
			readStream: readStream,
			cancel: () => {
				readStream.close()
			},
		}
	}
	async pipePackageStream(sourceStream: NodeJS.ReadableStream): Promise<PackageWriteStreamWrapper> {
		const writeStream = sourceStream.pipe(fs.createWriteStream(this.fullPath))

		const streamWrapper: PackageWriteStreamWrapper = new PackageWriteStreamWrapper(() => {
			// can't really abort the write stream
		})

		// Pipe any events from the writeStream right into the wrapper:
		writeStream.on('error', (err) => streamWrapper.emit('error', err))
		writeStream.on('close', () => streamWrapper.emit('close'))

		return streamWrapper
	}

	// Note: We handle metadata by storing a metadata json-file to the side of the file.

	async fetchMetadata(): Promise<Metadata | undefined> {
		try {
			await fsAccess(this.metadataPath, fs.constants.R_OK)
			// The file exists

			const text = await fsReadFile(this.metadataPath, {
				encoding: 'utf-8',
			})
			return JSON.parse(text)
		} catch (err) {
			// File doesn't exist
			return undefined
		}
	}
	async updateMetadata(metadata: Metadata): Promise<void> {
		await fsWriteFile(this.metadataPath, JSON.stringify(metadata))
	}
	async removeMetadata(): Promise<void> {
		await this.unlinkIfExists(this.metadataPath)
	}
	private get metadataPath() {
		return this.fullPath + '_metadata.json'
	}
}
