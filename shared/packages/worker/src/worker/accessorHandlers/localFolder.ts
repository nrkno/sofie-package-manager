import path from 'path'
import { promisify } from 'util'
import fs from 'fs'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { PackageReadInfo, PutPackageHandler } from './genericHandle'
import { Expectation, PackageContainerExpectation } from '@shared/api'
import { GenericWorker } from '../worker'
import { assertNever } from '../lib/lib'
import { GenericFileAccessorHandle, LocalFolderAccessorHandleType } from './lib/FileHandler'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsOpen = promisify(fs.open)
const fsClose = promisify(fs.close)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)

/** Accessor handle for accessing files in a local folder */
export class LocalFolderAccessorHandle<Metadata> extends GenericFileAccessorHandle<Metadata> {
	static readonly type = LocalFolderAccessorHandleType

	private content: {
		onlyContainerAccess?: boolean
		filePath?: string
	}
	private workOptions: Expectation.WorkOptions.RemoveDelay

	constructor(
		worker: GenericWorker,
		accessorId: string,
		private accessor: AccessorOnPackage.LocalFolder,
		content: any, // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
		workOptions: any // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
	) {
		super(worker, accessorId, accessor, content, LocalFolderAccessorHandle.type)

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
		const accessor = accessor0 as AccessorOnPackage.LocalFolder
		return !accessor.resourceId || accessor.resourceId === worker.location.localComputerId
	}
	/** Full path to the package */
	get fullPath(): string {
		return path.join(this.folderPath, this.filePath)
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
		if (!this.content.onlyContainerAccess) {
			if (!this.filePath) return `File path not set`
		}
		return undefined // all good
	}
	async checkPackageReadAccess(): Promise<string | undefined> {
		try {
			await fsAccess(this.fullPath, fs.constants.R_OK)
			// The file exists
		} catch (err) {
			// File is not readable
			return `Not able to access file: ${err.toString()}`
		}
		return undefined // all good
	}
	async tryPackageRead(): Promise<string | undefined> {
		try {
			// Check if we can open the file for reading:
			const fd = await fsOpen(this.fullPath, 'r+')

			// If that worked, we seem to have read access.
			await fsClose(fd)
		} catch (err) {
			if (err && err.code === 'EBUSY') {
				return `Not able to read file (busy)`
			} else if (err && err.code === 'ENOENT') {
				return `File does not exist (ENOENT)`
			} else {
				return `Not able to read file: ${err.toString()}`
			}
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
	async getPackageActualVersion(): Promise<Expectation.Version.FileOnDisk> {
		const stat = await fsStat(this.fullPath)
		return this.convertStatToVersion(stat)
	}
	async removePackage(): Promise<void> {
		if (this.workOptions.removeDelay) {
			await this.delayPackageRemoval(this.filePath, this.workOptions.removeDelay)
		} else {
			await this.removeMetadata()
			await this.unlinkIfExists(this.fullPath)
		}
	}
	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		const readStream = await new Promise<fs.ReadStream>((resolve, reject) => {
			const rs: fs.ReadStream = fs.createReadStream(this.fullPath)
			rs.once('error', reject)
			// Wait for the stream to be actually valid before continuing:
			rs.once('open', () => resolve(rs))
		})

		return {
			readStream: readStream,
			cancel: () => {
				readStream.close()
			},
		}
	}
	async putPackageStream(sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		await this.clearPackageRemoval(this.filePath)

		const writeStream = sourceStream.pipe(fs.createWriteStream(this.fullPath))

		const streamWrapper: PutPackageHandler = new PutPackageHandler(() => {
			writeStream.destroy()
		})

		// Pipe any events from the writeStream right into the wrapper:
		writeStream.on('error', (err) => streamWrapper.emit('error', err))
		writeStream.on('close', () => streamWrapper.emit('close'))

		return streamWrapper
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('LocalFolder.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		// await this.removeDeferRemovePackage()
		throw new Error('LocalFolder.putPackageInfo: Not supported')
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
	async runCronJob(packageContainerExp: PackageContainerExpectation): Promise<string | undefined> {
		const cronjobs = Object.keys(packageContainerExp.cronjobs) as (keyof PackageContainerExpectation['cronjobs'])[]
		for (const cronjob of cronjobs) {
			if (cronjob === 'interval') {
				// ignore
			} else if (cronjob === 'cleanup') {
				await this.removeDuePackages()
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of cronjobs are handled:
				assertNever(cronjob)
			}
		}

		return undefined
	}
	async setupPackageContainerMonitors(packageContainerExp: PackageContainerExpectation): Promise<string | undefined> {
		const monitors = Object.keys(packageContainerExp.monitors) as (keyof PackageContainerExpectation['monitors'])[]
		for (const monitor of monitors) {
			if (monitor === 'packages') {
				// setup file monitor:
				this.setupPackagesMonitor(packageContainerExp)
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of monitors are handled:
				assertNever(monitor)
			}
		}

		return undefined // all good
	}
	async disposePackageContainerMonitors(
		packageContainerExp: PackageContainerExpectation
	): Promise<string | undefined> {
		const monitors = Object.keys(packageContainerExp.monitors) as (keyof PackageContainerExpectation['monitors'])[]
		for (const monitor of monitors) {
			if (monitor === 'packages') {
				// dispose of the file monitor:
				this.disposePackagesMonitor()
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of monitors are handled:
				assertNever(monitor)
			}
		}
		return undefined // all good
	}

	/** Called when the package is supposed to be in place */
	async packageIsInPlace(): Promise<void> {
		await this.clearPackageRemoval(this.filePath)
	}

	/** Path to the PackageContainer, ie the folder */
	get folderPath(): string {
		if (!this.accessor.folderPath) throw new Error(`LocalFolderAccessor: accessor.folderPath not set!`)
		return this.accessor.folderPath
	}
	/** Local path to the Package, ie the File */
	get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this.accessor.filePath || this.content.filePath
		if (!filePath) throw new Error(`LocalFolderAccessor: filePath not set!`)
		return filePath
	}
	/** Full path to the metadata file */
	private get metadataPath() {
		return this.fullPath + '_metadata.json'
	}
}
