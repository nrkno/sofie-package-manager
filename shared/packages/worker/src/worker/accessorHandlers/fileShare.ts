import { promisify } from 'util'
import fs from 'fs'
import {
	AccessorConstructorProps,
	AccessorHandlerCheckHandleBasicResult,
	AccessorHandlerCheckHandleReadResult,
	AccessorHandlerCheckHandleWriteResult,
	AccessorHandlerCheckPackageContainerWriteAccessResult,
	AccessorHandlerCheckPackageReadAccessResult,
	AccessorHandlerRunCronJobResult,
	AccessorHandlerTryPackageReadResult,
	GenericAccessorHandle,
	PackageOperation,
	PackageReadInfo,
	PutPackageHandler,
	SetupPackageContainerMonitorsResult,
} from './genericHandle'
import {
	Accessor,
	AccessorOnPackage,
	Expectation,
	PackageContainerExpectation,
	assertNever,
	Reason,
	stringifyError,
	promiseTimeout,
	INNER_ACTION_TIMEOUT,
	protectString,
	DataId,
	MonitorId,
	betterPathResolve,
	betterPathIsAbsolute,
} from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { GenericWorker } from '../workers/genericWorker/genericWorker'
import networkDrive from 'windows-network-drive'
import { exec } from 'child_process'
import { FileShareAccessorHandleType, GenericFileAccessorHandle } from './lib/FileHandler'
import { MonitorInProgress } from '../lib/monitorInProgress'
import { MAX_EXEC_BUFFER } from '../lib/lib'
import { defaultCheckHandleRead, defaultCheckHandleWrite } from './lib/lib'
import * as path from 'path'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsOpen = promisify(fs.open)
const fsClose = promisify(fs.close)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const fsRename = promisify(fs.rename)
const fsMkDir = promisify(fs.mkdir)
const pExec = promisify(exec)

const PREPARE_FILE_ACCESS_TIMEOUT = INNER_ACTION_TIMEOUT * 0.5
const PREPARE_FILE_ACCESS_TIMEOUT_INNER = PREPARE_FILE_ACCESS_TIMEOUT * 0.8

export interface Content {
	/** This is set when the class-instance is only going to be used for PackageContainer access.*/
	onlyContainerAccess?: boolean
	filePath?: string
}

/** Accessor handle for accessing files on a network share */
export class FileShareAccessorHandle<Metadata> extends GenericFileAccessorHandle<Metadata> {
	static readonly type = FileShareAccessorHandleType
	private originalFolderPath: string | undefined
	private actualFolderPath: string | undefined

	public disableDriveMapping = false

	private content: Content
	private workOptions: Expectation.WorkOptions.RemoveDelay & Expectation.WorkOptions.UseTemporaryFilePath
	private accessor: AccessorOnPackage.FileShare

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.FileShare>) {
		super({
			...arg,
			type: FileShareAccessorHandle.type,
		})
		this.accessor = arg.accessor
		this.content = arg.content
		this.workOptions = arg.workOptions
		this.originalFolderPath = this.accessor.folderPath
		this.actualFolderPath = this.originalFolderPath // To be overwritten later

		// Verify content data:
		if (!arg.content.onlyContainerAccess) {
			if (!this._getFilePath())
				throw new Error('Bad input data: neither content.filePath nor accessor.filePath are set!')
		}

		if (arg.workOptions.removeDelay && typeof arg.workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
		if (arg.workOptions.useTemporaryFilePath && typeof arg.workOptions.useTemporaryFilePath !== 'boolean')
			throw new Error('Bad input data: workOptions.useTemporaryFilePath is not a boolean!')
	}
	/** Path to the PackageContainer, ie the folder on the share */
	get folderPath(): string {
		const folderPath = this.disableDriveMapping ? this.originalFolderPath : this.actualFolderPath

		if (!folderPath) throw new Error(`FileShareAccessor: accessor.folderPath not set!`)
		return folderPath
	}
	get orgFolderPath(): string {
		const folderPath = this.originalFolderPath

		if (!folderPath) throw new Error(`FileShareAccessor: accessor.folderPath not set!`)
		return folderPath
	}
	/** Full path to the package */
	get fullPath(): string {
		return this.getFullPath(this.filePath)
	}
	static doYouSupportAccess(worker: BaseWorker, accessor0: AccessorOnPackage.Any): boolean {
		const accessor = accessor0 as AccessorOnPackage.FileShare
		return !accessor.networkId || worker.agentAPI.location.localNetworkIds.includes(accessor.networkId)
	}
	get packageName(): string {
		return this.fullPath
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.FILE_SHARE) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `FileShare Accessor type is not FILE_SHARE ("${this.accessor.type}")!`,
				},
			}
		}
		if (!this.originalFolderPath)
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
		const readIssue = await this._checkPackageReadAccess()
		if (!readIssue.success) {
			if (readIssue.reason.tech.match(/EPERM/)) {
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
	private async _checkPackageReadAccess(): Promise<AccessorHandlerCheckPackageReadAccessResult> {
		await this.prepareFileAccess()

		try {
			await fsAccess(this.fullPath, fs.constants.R_OK)
			// The file exists
		} catch (err) {
			// File is not readable
			return {
				success: false,
				knownReason: true,
				reason: {
					user: `File doesn't exist`,
					tech: `Not able to read file: ${stringifyError(err, true)}`,
				},
			}
		}
		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		await this.prepareFileAccess()
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
		await this.prepareFileAccess()
		const stat = await fsStat(this.fullPath)
		return this.convertStatToVersion(stat)
	}
	async removePackage(reason: string): Promise<void> {
		await this.prepareFileAccess()
		if (this.workOptions.removeDelay) {
			this.logOperation(
				`Remove package: Delay remove file "${this.packageName}", delay: ${this.workOptions.removeDelay} (${reason})`
			)
			await this.delayPackageRemoval(this.filePath, this.workOptions.removeDelay)
		} else {
			await this.removeMetadata()
			if (await this.unlinkIfExists(this.fullPath)) {
				this.logOperation(`Remove package: Removed file "${this.packageName}", ${reason}`)
			} else {
				this.logOperation(`Remove package: File already removed "${this.packageName}" (${reason})`)
			}
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

		const fullPath = this.workOptions.useTemporaryFilePath ? this.temporaryFilePath : this.fullPath

		await fsMkDir(path.dirname(fullPath), { recursive: true }) // Create folder if it doesn't exist

		// Remove the file if it already exists:
		if (await this.unlinkIfExists(fullPath)) this.logOperation(`Put package stream: Remove file "${fullPath}"`)

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

	async finalizePackage(operation: PackageOperation): Promise<void> {
		operation.logDone()

		if (this.workOptions.useTemporaryFilePath) {
			if (await this.unlinkIfExists(this.fullPath)) {
				this.logOperation(`Finalize package: Removed file "${this.fullPath}"`)
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
	/** Called when the package is supposed to be in place (or is about to be put in place very soon) */
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		await this.clearPackageRemoval(this.filePath)
		return this.logWorkOperation(operationName, source, this.packageName)
	}

	/** Local path to the Package, ie the File */
	get filePath(): string {
		if (this.content.onlyContainerAccess) throw new Error('onlyContainerAccess is set!')

		const filePath = this._getFilePath()
		if (!filePath) throw new Error(`FileShareAccessor: filePath not set!`)
		return filePath
	}
	/** Full path to a temporary file */
	get temporaryFilePath(): string {
		return this.fullPath + '.pmtemp'
	}
	private get metadataPath() {
		return this.getMetadataPath(this.filePath)
	}
	/**
	 * Make preparations for file access (such as map a drive letter).
	 * This method should be called prior to any file access being made.
	 */
	async prepareFileAccess(forceRemount = false): Promise<void> {
		if (!this.originalFolderPath) throw new Error(`FileShareAccessor: accessor.folderPath not set!`)
		const folderPath = this.originalFolderPath

		let handlingDone = false

		if (process.platform !== 'win32') return // Only supported on Windows

		if (!this.disableDriveMapping && this.worker.type === GenericWorker.type) {
			// On windows, we can assign the share to a drive letter, as that increases performance quite a lot:
			const genericWorker = this.worker as GenericWorker

			const STORE_DRIVE_LETTERS = protectString<DataId>(
				`fileShare_driveLetters_${this.worker.agentAPI.location.localComputerId}`
			)
			// Note: Use the mappedDriveLetters as a WorkerStorage, to avoid a potential issue where other workers
			// mess with the drive letter at the same time that we do, and we all end up to be unsynced with reality.

			if (!forceRemount) {
				// Fast-path, just read the drive letter from the store:
				// Note: This is a fast path in the case of many jobs fired at several Workers simultaneously,
				// they can all read in parallel from the same store. When doing a .workerStorageWrite(), that is a single-threaded process.

				const mappedDriveLetters: MappedDriveLetters =
					(await this.worker.agentAPI.workerStorageRead<MappedDriveLetters>(STORE_DRIVE_LETTERS)) ?? {}

				// Check if the drive letter has already been assigned in our cache:
				let foundMappedDriveLetter: string | null = null
				for (const [driveLetter, mountedPath] of Object.entries<string>(mappedDriveLetters)) {
					if (mountedPath === folderPath) {
						foundMappedDriveLetter = driveLetter
					}
				}
				if (foundMappedDriveLetter) {
					// It seems a drive letter is already mapped up.
					this.actualFolderPath = `${foundMappedDriveLetter}:\\`
					handlingDone = true
				}
			}

			if (!handlingDone) {
				await this.worker.agentAPI.workerStorageWrite<MappedDriveLetters>(
					STORE_DRIVE_LETTERS,
					PREPARE_FILE_ACCESS_TIMEOUT,
					async (mappedDriveLetters0): Promise<MappedDriveLetters> => {
						const mappedDriveLetters: MappedDriveLetters = mappedDriveLetters0 ?? {}
						// First we check if the drive letter has already been assigned in our cache:
						let foundMappedDriveLetter: string | null = null
						for (const [driveLetter, mountedPath] of Object.entries<string>(mappedDriveLetters)) {
							if (mountedPath === folderPath) {
								foundMappedDriveLetter = driveLetter
							}
						}

						if (foundMappedDriveLetter && forceRemount) {
							// Force a re-mount of the drive letter:
							delete mappedDriveLetters[foundMappedDriveLetter]
							await promiseTimeout(
								networkDrive.unmount(foundMappedDriveLetter),
								PREPARE_FILE_ACCESS_TIMEOUT_INNER,
								(timeoutDuration) =>
									`networkDrive.unmount: Timeout after ${timeoutDuration}ms (trying to unmount "${foundMappedDriveLetter}", new network path: "${folderPath}")`
							)

							foundMappedDriveLetter = null
						}

						if (foundMappedDriveLetter) {
							// It seems a drive letter is already mapped up.
							this.actualFolderPath = `${foundMappedDriveLetter}:\\`
							handlingDone = true
						}
						if (!handlingDone) {
							// Update our cache of mounted drive letters:
							for (const [driveLetter, mount] of Object.entries<networkDrive.DriveInfo>(
								await this.getMountedDriveLetters(`new network path: "${folderPath}")`)
							)) {
								mappedDriveLetters[driveLetter] = mount.path
								// If the mounted path is the one we want, we don't have to mount a new one:
								if (mount.path === folderPath) {
									foundMappedDriveLetter = driveLetter
								}
							}
							if (foundMappedDriveLetter) {
								this.actualFolderPath = `${foundMappedDriveLetter}:\\`
								handlingDone = true
							}
						}

						if (!handlingDone) {
							// Find next free drive letter:
							const freeDriveLetter = genericWorker.agentAPI.config.windowsDriveLetters?.find(
								(driveLetter) => !mappedDriveLetters[driveLetter]
							)

							if (freeDriveLetter) {
								// Try to map the remote share onto a drive:

								try {
									await promiseTimeout(
										networkDrive.mount(
											folderPath,
											freeDriveLetter,
											this.accessor.userName,
											this.accessor.password
										),
										PREPARE_FILE_ACCESS_TIMEOUT_INNER,
										(timeoutDuration) =>
											`networkDrive.mount: Timeout after ${timeoutDuration}ms (trying to mount "${folderPath}" onto drive "${freeDriveLetter}")`
									)
									this.worker.logger.info(
										`networkDrive.mount: Mounted "${folderPath}" onto drive "${freeDriveLetter}"`
									)
								} catch (e) {
									const errStr = `${e}`
									if (
										errStr.match(/invalid response/i) ||
										errStr.match(/Ugyldig svar/i) // "Invalid response" in Norwegian
									) {
										// Temporary handling of the error

										const mappedDrives = await this.getMountedDriveLetters(
											`Handle error "${errStr}" when trying to mount "${folderPath}", new network path: "${folderPath}")`
										)

										if (mappedDrives[freeDriveLetter]?.path === folderPath) {
											this.worker.logger.warn(`Suppressed error: ${errStr}`)

											this.worker.logger.warn(
												`Mapped drives: ${Object.keys(mappedDrives).join(',')}`
											)
											this.worker.logger.warn(
												`${freeDriveLetter} is currently mapped to ${mappedDrives[freeDriveLetter]}`
											)
										} else {
											this.worker.logger.warn(
												`Mapped drives: ${Object.keys(mappedDrives).join(',')}`
											)
											this.worker.logger.warn(
												`${freeDriveLetter} is currently mapped to ${mappedDrives[freeDriveLetter]}`
											)
											throw e
										}
									} else throw e
								}

								mappedDriveLetters[freeDriveLetter] = folderPath
								this.actualFolderPath = `${freeDriveLetter}:\\`
								handlingDone = true
							} else {
								// Not able to find any free drive letters.
								// Revert to direct access then
							}
						}
						return mappedDriveLetters
					}
				)
			}
		}

		if (!handlingDone) {
			// We're reverting to accessing through the direct path instead
			if (this.worker.type === GenericWorker.type && this.accessor.userName) {
				// Try to add the credentials to the share in Windows:
				const setupCredentialsCommand = `net use "${folderPath}" /user:${this.accessor.userName} ${this.accessor.password}`
				try {
					await pExec(setupCredentialsCommand, {
						maxBuffer: MAX_EXEC_BUFFER,
					})
				} catch (err) {
					if (stringifyError(err, true).match(/multiple connections to a/i)) {
						// "Multiple connections to a server or shared resource by the same user, using more than one user name, are not allowed. Disconnect all previous connections to the server or shared resource and try again."

						// Remove the old and try again:
						await pExec(`net use "${folderPath}" /d`)
						await pExec(setupCredentialsCommand, { maxBuffer: MAX_EXEC_BUFFER })
					} else {
						throw err
					}
				}
			}
			this.actualFolderPath = folderPath
			handlingDone = true
		}
		if (!handlingDone) {
			// Last resort, just use the direct path:
			this.actualFolderPath = folderPath
			handlingDone = true
		}
	}
	private async getMountedDriveLetters(reason: string): Promise<{ [driveLetter: string]: networkDrive.DriveInfo }> {
		let usedDriveLetters: { [driveLetter: string]: networkDrive.DriveInfo } = {}

		if (process.platform !== 'win32') return usedDriveLetters // Only supported on Windows

		try {
			// usedDriveLetters = (await networkDrive.list()) as { [driveLetter: string]: string }
			usedDriveLetters = await promiseTimeout(
				networkDrive.list(),
				PREPARE_FILE_ACCESS_TIMEOUT_INNER,
				(timeoutDuration) =>
					`networkDrive.listNetworkDrives: Timeout after ${timeoutDuration}ms, reason: ${reason}`
			)
		} catch (err) {
			if (stringifyError(err, true).match(/No Instance\(s\) Available/)) {
				// this error comes when the list is empty
				usedDriveLetters = {}
			} else {
				throw err
			}
		}
		return usedDriveLetters
	}
	private async checkPackageContainerReadAccess(): Promise<AccessorHandlerRunCronJobResult> {
		await this.prepareFileAccess()
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
		return this.accessor.filePath || this.content.filePath
	}
}
interface MappedDriveLetters {
	[driveLetter: string]: string
}
