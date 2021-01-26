import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle, PackageWriteStreamWrapper } from './genericHandle'
import { Expectation } from '../expectationApi'
import { GenericWorker } from '../worker'
import { WindowsWorker } from '../workers/windowsWorker/windowsWorker'
import * as networkDrive from 'windows-network-drive'
import { exec } from 'child_process'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const pExec = promisify(exec)

/** Accessor handle for accessing files on a network share */
export class FileShareAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	private actualFolderPath: string | undefined
	private mappedDriveLetters: {
		[driveLetter: string]: string
	} = {}
	constructor(
		worker: GenericWorker,
		private accessor: AccessorOnPackage.FileShare,
		private content: {
			filePath: string
		}
	) {
		super(worker, accessor, content, 'fileShare')
		this.actualFolderPath = this.accessor.folderPath // To be overwrittenlater
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
		if (this.accessor.type !== Accessor.AccessType.FILE_SHARE) {
			return `FileShare Accessor type is not FILE_SHARE ("${this.accessor.type}")!`
		}
		if (!this.accessor.folderPath) return `Folder path not set`
		if (!this.filePath) return `File path not set`
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
	async getPackageActualVersion(): Promise<Expectation.Version.MediaFile> {
		await this.prepareFileAccess()
		const stat = await fsStat(this.fullPath)
		return this.convertStatToVersion(stat)
	}
	async removePackage(): Promise<void> {
		await this.prepareFileAccess()
		await this.unlinkIfExists(this.fullPath)
	}

	get folderPath(): string {
		if (!this.actualFolderPath) throw new Error(`FileShareAccessor: accessor.folderPath not set!`)
		return this.actualFolderPath
	}
	private get filePath(): string {
		const filePath = this.accessor.filePath || this.content.filePath
		if (!filePath) throw new Error(`FileShareAccessor: filePath not set!`)
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
		await this.prepareFileAccess()
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
		await this.prepareFileAccess()

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

	private async prepareFileAccess(forceRemount = false): Promise<void> {
		if (!this.accessor.folderPath) throw new Error(`FileShareAccessor: accessor.folderPath not set!`)
		const folderPath = this.accessor.folderPath

		if (this.worker.type === 'windowsWorker') {
			// On windows, we can assign the share to a drive letter, as that increases performance quite a lot:
			const windowsWorker = this.worker as WindowsWorker

			// First we chack if the drive letter has already been assigned in the cache:
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
				// Find a free drive letter:
				const freeDriveLetter = windowsWorker.config.allowedMappedDriveLetters.find(
					(driveLetter) => !this.mappedDriveLetters[driveLetter]
				)

				if (freeDriveLetter) {
					// Before we mount it, do a final check if it is already mounted:
					for (const [driveLetter, mountedPath] of Object.entries(await this.getMountedDriveLetters())) {
						if (mountedPath === folderPath) {
							foundMappedDriveLetter = driveLetter
						}
					}
					if (foundMappedDriveLetter) {
						this.mappedDriveLetters[freeDriveLetter] = folderPath
						this.actualFolderPath = `${freeDriveLetter}:\\`
						return
					}

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
