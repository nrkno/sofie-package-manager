import { promisify } from 'util'
import * as fs from 'fs'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { PackageReadInfo, PutPackageHandler } from './genericHandle'
import { Expectation, PackageContainerExpectation } from '@shared/api'
import { GenericWorker } from '../worker'
import { WindowsWorker } from '../workers/windowsWorker/windowsWorker'
import * as networkDrive from 'windows-network-drive'
import { exec } from 'child_process'
import { assertNever } from '../lib/lib'
import { FileShareAccessorHandleType, GenericFileAccessorHandle } from './lib/FileHandler'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsOpen = promisify(fs.open)
const fsClose = promisify(fs.close)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const pExec = promisify(exec)

/** Accessor handle for accessing files on a network share */
export class FileShareAccessorHandle<Metadata> extends GenericFileAccessorHandle<Metadata> {
	static readonly type = FileShareAccessorHandleType
	private actualFolderPath: string | undefined

	private mappedDriveLetters: {
		[driveLetter: string]: string
	} = {}

	private content: {
		onlyContainerAccess?: boolean
		filePath?: string
	}
	private workOptions: Expectation.WorkOptions.RemoveDelay

	constructor(
		worker: GenericWorker,
		accessorId: string,
		private accessor: AccessorOnPackage.FileShare,
		content: any, // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
		workOptions: any // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
	) {
		super(worker, accessorId, accessor, content, FileShareAccessorHandle.type)
		this.actualFolderPath = this.accessor.folderPath // To be overwrittenlater

		// Verify content data:
		if (!content.onlyContainerAccess) {
			if (!content.filePath) throw new Error('Bad input data: content.filePath not set!')
		}
		this.content = content
		if (workOptions.removeDelay && typeof workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
		this.workOptions = workOptions
	}
	/** Path to the PackageContainer, ie the folder on the share */
	get folderPath(): string {
		if (!this.actualFolderPath) throw new Error(`FileShareAccessor: accessor.folderPath not set!`)
		return this.actualFolderPath
	}
	/** Full path to the package */
	get fullPath(): string {
		return this.getFullPath(this.filePath)
	}
	static doYouSupportAccess(worker: GenericWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.FileShare
		return !accessor.networkId || worker.location.localNetworkIds.includes(accessor.networkId)
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
		if (this.accessor.type !== Accessor.AccessType.FILE_SHARE) {
			return `FileShare Accessor type is not FILE_SHARE ("${this.accessor.type}")!`
		}
		if (!this.accessor.folderPath) return `Folder path not set`
		if (!this.content.onlyContainerAccess) {
			if (!this.filePath) return `File path not set`
		}
		return undefined // all good
	}
	async checkPackageReadAccess(): Promise<string | undefined> {
		const readIssue = await this._checkPackageReadAccess()
		if (readIssue) {
			if (readIssue.match(/EPERM/)) {
				// "EPERM: operation not permitted"
				if (this.accessor.userName) {
					// Try resetting the access permissions:
					await this.prepareFileAccess(true)

					// Try now:
					return this._checkPackageReadAccess()
				}
			} else {
				return readIssue
			}
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
	private async _checkPackageReadAccess(): Promise<string | undefined> {
		await this.prepareFileAccess()

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
		await this.prepareFileAccess()
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
		await this.prepareFileAccess()
		const stat = await fsStat(this.fullPath)
		return this.convertStatToVersion(stat)
	}
	async removePackage(): Promise<void> {
		await this.prepareFileAccess()
		if (this.workOptions.removeDelay) {
			await this.delayPackageRemoval(this.filePath, this.workOptions.removeDelay)
		} else {
			await this.removeMetadata()
			await this.unlinkIfExists(this.fullPath)
		}
	}

	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		await this.prepareFileAccess()
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
		await this.prepareFileAccess()
		await this.clearPackageRemoval(this.filePath)

		const writeStream = sourceStream.pipe(fs.createWriteStream(this.fullPath))

		const streamWrapper: PutPackageHandler = new PutPackageHandler(() => {
			// can't really abort the write stream
		})

		// Pipe any events from the writeStream right into the wrapper:
		writeStream.on('error', (err) => streamWrapper.emit('error', err))
		writeStream.on('close', () => streamWrapper.emit('close'))

		return streamWrapper
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('FileShare.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		// await this.removeDeferRemovePackage()
		throw new Error('FileShare.putPackageInfo: Not supported')
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
	/** Local path to the Package, ie the File */
	private get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')

		const filePath = this.accessor.filePath || this.content.filePath
		if (!filePath) throw new Error(`FileShareAccessor: filePath not set!`)
		return filePath
	}

	private get metadataPath() {
		return this.getMetadataPath(this.filePath)
	}
	/**
	 * Make preparations for file access (such as map a drive letter).
	 * This method should be called prior to any file access being made.
	 */
	private async prepareFileAccess(forceRemount = false): Promise<void> {
		if (!this.accessor.folderPath) throw new Error(`FileShareAccessor: accessor.folderPath not set!`)
		const folderPath = this.accessor.folderPath

		if (this.worker.type === WindowsWorker.type) {
			// On windows, we can assign the share to a drive letter, as that increases performance quite a lot:
			const windowsWorker = this.worker as WindowsWorker

			// First we check if the drive letter has already been assigned in our cache:
			let foundMappedDriveLetter: string | null = null
			for (const [driveLetter, mountedPath] of Object.entries(this.mappedDriveLetters)) {
				if (mountedPath === folderPath) {
					foundMappedDriveLetter = driveLetter
				}
			}

			if (foundMappedDriveLetter && forceRemount) {
				// Force a re-mount of the drive letter:
				delete this.mappedDriveLetters[foundMappedDriveLetter]
				await networkDrive.unmount(foundMappedDriveLetter)
				foundMappedDriveLetter = null
			}

			if (foundMappedDriveLetter) {
				// It seems a drive letter is already mapped up.
				this.actualFolderPath = `${foundMappedDriveLetter}:\\`
				return
			} else {
				// Update our cache of mounted drive letters:
				for (const [driveLetter, mountedPath] of Object.entries(await this.getMountedDriveLetters())) {
					this.mappedDriveLetters[driveLetter] = mountedPath
					// If the mounted path is the one we want, we don't have to mount a new one:
					if (mountedPath === folderPath) {
						foundMappedDriveLetter = driveLetter
					}
				}
				if (foundMappedDriveLetter) {
					this.actualFolderPath = `${foundMappedDriveLetter}:\\`
					return
				}

				// Find next free drive letter:
				const freeDriveLetter = windowsWorker.config.windowsDriveLetters?.find(
					(driveLetter) => !this.mappedDriveLetters[driveLetter]
				)

				if (freeDriveLetter) {
					// Try to map the remote share onto a drive:
					await networkDrive.mount(
						folderPath,
						freeDriveLetter,
						this.accessor.userName,
						this.accessor.password
					)

					this.mappedDriveLetters[freeDriveLetter] = folderPath
					this.actualFolderPath = `${freeDriveLetter}:\\`
					return
				} else {
					// Not able to find any free drive letters.
					// Revert to direct access then
				}
			}
			// We're reverting to accessing through the direct path instead
			if (this.accessor.userName) {
				const MAX_BUFFER_SIZE = 2000 * 1024

				// Try to add the credentials to the share in Windows:
				const setupCredentialsCommand = `net use "${folderPath}" /user:${this.accessor.userName} ${this.accessor.password}`
				try {
					await pExec(setupCredentialsCommand, { maxBuffer: MAX_BUFFER_SIZE })
				} catch (err) {
					if (err.toString().match(/multiple connections to a/i)) {
						// "Multiple connections to a server or shared resource by the same user, using more than one user name, are not allowed. Disconnect all previous connections to the server or shared resource and try again."

						// Remove the old and try again:
						await pExec(`net use "${folderPath}" /d`)
						await pExec(setupCredentialsCommand, { maxBuffer: MAX_BUFFER_SIZE })
					} else {
						throw err
					}
				}
			}
		}

		this.actualFolderPath = folderPath
		return
	}
	private async getMountedDriveLetters(): Promise<{ [key: string]: string }> {
		let usedDriveLetters: { [key: string]: string } = {}

		try {
			usedDriveLetters = (await networkDrive.list()) as any
		} catch (e) {
			if (e.toString().match(/No Instance\(s\) Available/)) {
				// this error comes when the list is empty
				usedDriveLetters = {}
			} else {
				throw e
			}
		}
		return usedDriveLetters
	}
}
