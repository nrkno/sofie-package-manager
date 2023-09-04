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
} from './genericHandle'
import {
	Accessor,
	AccessorOnPackage,
	Expectation,
	PackageContainerExpectation,
	assertNever,
	Reason,
	stringifyError,
	AccessorId,
	MonitorId,
	protectString,
} from '@sofie-package-manager/api'
import { GenericWorker } from '../worker'
import { GenericFileAccessorHandle, LocalFolderAccessorHandleType } from './lib/FileHandler'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { compareResourceIds } from '../workers/windowsWorker/lib/lib'
import { defaultCheckHandleRead, defaultCheckHandleWrite } from './lib/lib'
import { mkdirp } from 'mkdirp'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsOpen = promisify(fs.open)
const fsClose = promisify(fs.close)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const fsRename = promisify(fs.rename)

/** Accessor handle for accessing files in a local folder */
export class LocalFolderAccessorHandle<Metadata> extends GenericFileAccessorHandle<Metadata> {
	static readonly type = LocalFolderAccessorHandleType

	private content: {
		/** This is set when the class-instance is only going to be used for PackageContainer access.*/
		onlyContainerAccess?: boolean
		filePath?: string
	}
	private workOptions: Expectation.WorkOptions.RemoveDelay & Expectation.WorkOptions.UseTemporaryFilePath

	constructor(
		worker: GenericWorker,
		accessorId: AccessorId,
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
		if (workOptions.useTemporaryFilePath && typeof workOptions.useTemporaryFilePath !== 'boolean')
			throw new Error('Bad input data: workOptions.useTemporaryFilePath is not a boolean!')
		this.workOptions = workOptions
	}
	static doYouSupportAccess(worker: GenericWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.LocalFolder
		return compareResourceIds(accessor.resourceId, worker.agentAPI.location.localComputerId)
	}
	get packageName(): string {
		return this.fullPath
	}
	/** Full path to the package */
	get fullPath(): string {
		return path.join(this.folderPath, this.filePath)
	}

	checkHandleRead(): AccessorHandlerCheckHandleReadResult {
		const defaultResult = defaultCheckHandleRead(this.accessor)
		if (defaultResult) return defaultResult
		return this.checkAccessor()
	}
	checkHandleWrite(): AccessorHandlerCheckHandleWriteResult {
		const defaultResult = defaultCheckHandleWrite(this.accessor)
		if (defaultResult) return defaultResult
		return this.checkAccessor()
	}
	private checkAccessor(): AccessorHandlerCheckHandleWriteResult {
		if (this.accessor.type !== Accessor.AccessType.LOCAL_FOLDER) {
			return {
				success: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `LocalFolder Accessor type is not LOCAL_FOLDER ("${this.accessor.type}")!`,
				},
			}
		}
		if (!this.accessor.folderPath)
			return { success: false, reason: { user: `Folder path not set`, tech: `Folder path not set` } }
		if (!this.content.onlyContainerAccess) {
			if (!this.filePath)
				return { success: false, reason: { user: `File path not set`, tech: `File path not set` } }
		}
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
					packageExists: true,
					reason: { user: `Not able to read file (file is busy)`, tech: `${stringifyError(err, true)}` },
				}
			} else if (err && (err as any).code === 'ENOENT') {
				return {
					success: false,
					packageExists: false,
					reason: { user: `File does not exist`, tech: `${stringifyError(err, true)}` },
				}
			} else {
				return {
					success: false,
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
			await this.delayPackageRemoval(this.filePath, this.workOptions.removeDelay)
		} else {
			await this.removeMetadata()
			if (await this.unlinkIfExists(this.fullPath))
				this.worker.logOperation(`Remove package: Removed file "${this.fullPath}" (${reason})`)
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

		await mkdirp(path.dirname(fullPath)) // Create folder if it doesn't exist

		// Remove the file if it exists:
		if (await this.unlinkIfExists(fullPath))
			this.worker.logOperation(`Put package stream: Remove file "${fullPath}"`)

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
				this.worker.logOperation(`Finalize package: Remove file "${this.fullPath}"`)
			}

			await fsRename(this.temporaryFilePath, this.fullPath)
			this.worker.logOperation(`Finalize package: Rename file "${this.temporaryFilePath}" to "${this.fullPath}"`)
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
		else return { success: false, reason: badReason }
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
				resultingMonitors[protectString<MonitorId>(monitorIdStr)] =
					this.setupPackagesMonitor(packageContainerExp)
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
		return this.worker.logWorkOperation(operationName, source, this.packageName)
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
		const filePath = this.accessor.filePath || this.content.filePath
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
				reason: {
					user: `Not able to read from container folder`,
					tech: `Not able to read from container folder: ${stringifyError(err, true)}`,
				},
			}
		}
		return { success: true }
	}
}
