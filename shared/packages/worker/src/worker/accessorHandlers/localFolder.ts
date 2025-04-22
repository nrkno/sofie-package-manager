import path from 'path'
import { promisify } from 'util'
import fs from 'fs'
import {
	PackageReadInfo,
	PutPackageHandler,
	SetupPackageContainerMonitorsResult,
	AccessorHandlerRunCronJobResult,
	AccessorHandlerCheckHandleReadResult,
	AccessorHandlerCheckHandleWriteResult,
	AccessorHandlerCheckPackageContainerWriteAccessResult,
	AccessorHandlerCheckPackageReadAccessResult,
	AccessorHandlerTryPackageReadResult,
	GenericAccessorHandle,
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
	stringifyError,
	MonitorId,
	protectString,
	betterPathResolve,
	betterPathIsAbsolute,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { GenericFileAccessorHandle, LocalFolderAccessorHandleType } from './lib/FileHandler'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { compareResourceIds } from '../workers/genericWorker/lib/lib'
import { defaultCheckHandleRead, defaultCheckHandleWrite } from './lib/lib'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsOpen = promisify(fs.open)
const fsClose = promisify(fs.close)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const fsRename = promisify(fs.rename)
const fsMkDir = promisify(fs.mkdir)

export interface Content {
	/** This is set when the class-instance is only going to be used for PackageContainer access.*/
	onlyContainerAccess?: boolean
	filePath?: string
	path?: string
}

/** Accessor handle for accessing files in a local folder */
export class LocalFolderAccessorHandle<Metadata> extends GenericFileAccessorHandle<Metadata> {
	static readonly type = LocalFolderAccessorHandleType

	private content: Content
	private workOptions: Expectation.WorkOptions.RemoveDelay & Expectation.WorkOptions.UseTemporaryFilePath
	private accessor: AccessorOnPackage.LocalFolder

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.LocalFolder>) {
		super({
			...arg,
			type: LocalFolderAccessorHandle.type,
		})
		this.accessor = arg.accessor
		this.workOptions = arg.workOptions
		this.content = arg.content

		// Verify content data:
		if (!this.content.onlyContainerAccess) {
			if (!this._getFilePath())
				throw new Error('Bad input data: neither accessor.filePath, content.filePath nor content.path are set!')
		}

		if (this.workOptions.removeDelay && typeof this.workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
		if (this.workOptions.useTemporaryFilePath && typeof this.workOptions.useTemporaryFilePath !== 'boolean')
			throw new Error('Bad input data: workOptions.useTemporaryFilePath is not a boolean!')
	}
	static doYouSupportAccess(worker: BaseWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.LocalFolder
		return compareResourceIds(accessor.resourceId, worker.agentAPI.location.localComputerId)
	}
	get packageName(): string {
		return this.fullPath
	}
	/** Full path to the package */
	get fullPath(): string {
		return this.getFullPath(this.filePath)
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.LOCAL_FOLDER) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `LocalFolder Accessor type is not LOCAL_FOLDER ("${this.accessor.type}")!`,
				},
			}
		}
		if (!this.accessor.folderPath)
			return {
				success: false,
				knownReason: true,
				reason: { user: `Folder path not set`, tech: `Folder path not set` },
			}
		if (!this.content.onlyContainerAccess) {
			if (!this.filePath)
				return {
					success: false,
					knownReason: true,
					reason: { user: `File path not set`, tech: `File path not set` },
				}

			// Don't allow absolute file paths:
			if (betterPathIsAbsolute(this.filePath))
				return {
					success: false,
					knownReason: true,
					reason: {
						user: `File path is an absolute path`,
						tech: `File path "${this.filePath}" is an absolute path`,
					},
				}

			// Ensure that the file path is not outside of the folder path:
			const fullPath = betterPathResolve(this.fullPath)
			const folderPath = betterPathResolve(this.folderPath)
			if (!fullPath.startsWith(folderPath))
				return {
					success: false,
					knownReason: true,
					reason: {
						user: `File path is outside of folder path`,
						tech: `Full path "${fullPath}" does not start with "${folderPath}"`,
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
		try {
			await fsAccess(this.fullPath, fs.constants.R_OK)
			// The file exists and can be read
		} catch (err) {
			// File is not readable
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `File doesn't exist`,
					tech: `Not able to access file: ${stringifyError(err, true)}`,
				},
			}
		}
		return { success: true }
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		try {
			// Check if we can open the file for reading:
			const fd = await fsOpen(this.fullPath, 'r')

			// If that worked, we seem to have read access.
			await fsClose(fd)
		} catch (err) {
			if (err && (err as any).code === 'EBUSY') {
				return {
					success: false,
					knownReason: true,
					packageExists: true,
					reason: { user: `Not able to read file (file is busy)`, tech: `${stringifyError(err, true)}` },
				}
			} else if (err && (err as any).code === 'ENOENT') {
				return {
					success: false,
					knownReason: true,
					packageExists: false,
					reason: { user: `File does not exist`, tech: `${stringifyError(err, true)}` },
				}
			} else {
				return {
					success: false,
					knownReason: false,
					packageExists: false,
					reason: { user: `Not able to read file`, tech: `${stringifyError(err, true)}` },
				}
			}
		}
		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		try {
			await fsAccess(this.folderPath, fs.constants.W_OK)
			// The file exists
		} catch (err) {
			// File is not writeable
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `Not able to write to container folder`,
					tech: `Not able to write to container folder: ${stringifyError(err, true)}`,
				},
			}
		}
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.FileOnDisk> {
		const stat = await fsStat(this.fullPath)
		return this.convertStatToVersion(stat)
	}
	async removePackage(reason: string): Promise<void> {
		if (this.workOptions.removeDelay) {
			this.logOperation(
				`Remove package: Delay remove file "${this.packageName}", delay: ${this.workOptions.removeDelay} (${reason})`
			)
			await this.delayPackageRemoval(this.filePath, this.workOptions.removeDelay)
		} else {
			await this.removeMetadata()
			if (await this.unlinkIfExists(this.fullPath)) {
				this.logOperation(`Remove package: Removed file "${this.packageName}" (${reason})`)
			} else {
				this.logOperation(`Remove package: File already removed "${this.packageName}" (${reason})`)
			}
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

		const fullPath = this.workOptions.useTemporaryFilePath ? this.temporaryFilePath : this.fullPath

		await fsMkDir(path.dirname(fullPath), { recursive: true }) // Create folder if it doesn't exist

		// Remove the file if it exists:
		if (await this.unlinkIfExists(fullPath)) this.logOperation(`Put package stream: Remove file "${fullPath}"`)

		const writeStream = sourceStream.pipe(fs.createWriteStream(fullPath))

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

	async finalizePackage(operation: PackageOperation): Promise<void> {
		operation.logDone()

		if (this.workOptions.useTemporaryFilePath) {
			if (await this.unlinkIfExists(this.fullPath)) {
				this.logOperation(`Finalize package: Remove file "${this.fullPath}"`)
			}

			await fsRename(this.temporaryFilePath, this.fullPath)
			this.logOperation(`Finalize package: Rename file "${this.temporaryFilePath}" to "${this.fullPath}"`)
		}
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
	async runCronJob(packageContainerExp: PackageContainerExpectation): Promise<AccessorHandlerRunCronJobResult> {
		// Always check read/write access first:
		const checkRead = await this.checkPackageContainerReadAccess()
		if (!checkRead.success) return checkRead

		if (this.accessor.allowWrite) {
			const checkWrite = await this.checkPackageContainerWriteAccess()
			if (!checkWrite.success) return checkWrite
		}

		let badReason: Reason | null = null
		const cronjobs = Object.keys(packageContainerExp.cronjobs) as (keyof PackageContainerExpectation['cronjobs'])[]
		for (const cronjob of cronjobs) {
			if (cronjob === 'interval') {
				// ignore
			} else if (cronjob === 'cleanup') {
				const options = packageContainerExp.cronjobs[cronjob]

				badReason = await this.removeDuePackages()
				if (!badReason && options?.cleanFileAge) badReason = await this.cleanupOldFiles(options.cleanFileAge)
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
				// setup file monitor:
				resultingMonitors[protectString<MonitorId>(monitorIdStr)] = await this.setupPackagesMonitor(
					packageContainerExp
				)
			} else {
				// Assert that cronjob is of type "never", to ensure that all types of monitors are handled:
				assertNever(monitorIdStr)
			}
		}

		return { success: true, monitors: resultingMonitors }
	}

	/** Called when the package is supposed to be in place */
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		await this.clearPackageRemoval(this.filePath)
		return this.logWorkOperation(operationName, source, this.packageName)
	}

	/** Path to the PackageContainer, ie the folder */
	get folderPath(): string {
		if (!this.accessor.folderPath) throw new Error(`LocalFolderAccessor: accessor.folderPath not set!`)
		return this.accessor.folderPath
	}
	get orgFolderPath(): string {
		return this.folderPath
	}

	/** Local path to the Package, ie the File */
	get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')
		const filePath = this._getFilePath()
		if (!filePath) throw new Error(`LocalFolderAccessor: filePath not set!`)
		return filePath
	}
	/** Full path to a temporary file */
	get temporaryFilePath(): string {
		return this.fullPath + '.pmtemp'
	}
	/** Full path to the metadata file */
	private get metadataPath() {
		return this.fullPath + '_metadata.json'
	}

	private async checkPackageContainerReadAccess(): Promise<AccessorHandlerRunCronJobResult> {
		try {
			await fsAccess(this.folderPath, fs.constants.R_OK)
			// The file exists
		} catch (err) {
			// File is not writeable
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `Not able to read from container folder`,
					tech: `Not able to read from container folder: ${stringifyError(err, true)}`,
				},
			}
		}
		return { success: true }
	}
	private _getFilePath(): string | undefined {
		return this.accessor.filePath || this.content.filePath || this.content.path
	}
}
