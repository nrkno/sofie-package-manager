import path from 'path'
import { promisify } from 'util'
import fs from 'fs'
import {
	ExpectedPackage,
	StatusCode,
	Accessor,
	AccessorOnPackage,
	Expectation,
	hashObj,
	literal,
	PackageContainerExpectation,
	assertNever,
	stringifyError,
	ExpectedPackageId,
	protectString,
	MonitorId,
	betterPathJoin,
	removeBasePath,
	resolveFileWithoutExtension,
} from '@sofie-package-manager/api'

import { AccessorConstructorProps, GenericAccessorHandle } from '../genericHandle'
import { MonitorInProgress } from '../../lib/monitorInProgress'
import { FileEvent, FileWatcher, IFileWatcher } from './FileWatcher'
import { GenericFileOperationsHandler } from './GenericFileOperations'
import { GenericFileHandler } from './GenericFileHandler'
import { JSONWriteFilesLockHandler } from './json-write-file'

export const LocalFolderAccessorHandleType = 'localFolder'
export const FileShareAccessorHandleType = 'fileShare'

const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)
const fsReaddir = promisify(fs.readdir)
const fsWriteFile = promisify(fs.writeFile)
const fsRmDir = promisify(fs.rmdir)
const fsStat = promisify(fs.stat)
const fsUnlink = promisify(fs.unlink)
const fsLstat = promisify(fs.lstat)
const fsRename = promisify(fs.rename)

/**
 * This class handles things that are common between the LocalFolder and FileShare classes
 */
export abstract class GenericFileAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	private _type: typeof LocalFolderAccessorHandleType | typeof FileShareAccessorHandleType

	constructor(
		arg: AccessorConstructorProps<AccessorOnPackage.Any> & {
			type: typeof LocalFolderAccessorHandleType | typeof FileShareAccessorHandleType
		}
	) {
		super(arg)
		this._type = arg.type
		this.workOptions = arg.workOptions

		if (this.workOptions.removeDelay && typeof this.workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')

		const fileHandler: GenericFileHandler = {
			logOperation: this.logOperation.bind(this),
			unlinkIfExists: this.unlinkIfExists.bind(this),
			getFullPath: this.getFullPath.bind(this),
			getMetadataPath: this.getMetadataPath.bind(this),
			fileExists: this.fileExists.bind(this),
			readFile: this.readFile.bind(this),
			readFileIfExists: this.readFileIfExists.bind(this),
			writeFile: this.writeFile.bind(this),
			listFilesInDir: this.listFilesInDir.bind(this),
			removeDirIfExists: this.removeDirIfExists.bind(this),
			rename: this.rename.bind(this),
		}

		const jsonWriter = this.worker.cacheData(this.type, 'jsonWriter', () => {
			return new JSONWriteFilesLockHandler(fileHandler, this.worker.logger)
		})

		this.fileHandler = new GenericFileOperationsHandler(
			fileHandler,
			jsonWriter,
			this.workOptions,
			this.worker.logger
		)
	}
	protected workOptions: Expectation.WorkOptions.RemoveDelay
	/** Path to the PackageContainer, ie the folder */
	protected abstract get folderPath(): string
	protected abstract get orgFolderPath(): string
	/**
	 * Full path to the package
	 * @deprecated Use getResolvedFullPath() instead, which handles filename resolution without extensions.
	 * This property should only be used internally.
	 */
	protected abstract get fullPath(): string

	public fileHandler: GenericFileOperationsHandler

	/** Unlink (remove) a file, if it exists. Returns true if it did exist */
	async unlinkIfExists(filePath: string): Promise<boolean> {
		if (!(await this.fileExists(filePath))) return false
		await fsUnlink(filePath)
		return true
	}
	async removeDirIfExists(filePath: string): Promise<boolean> {
		if (!(await this.fileExists(filePath))) return false
		await fsRmDir(filePath)
		return true
	}
	async rename(from: string, to: string): Promise<void> {
		await fsRename(from, to)
	}

	async fileExists(filePath: string): Promise<boolean> {
		let exists = false
		try {
			await fsAccess(filePath, fs.constants.R_OK)
			// The file exists
			exists = true
		} catch (err) {
			// Ignore errors
		}
		return exists
	}
	/**
	 * Get the resolved full path to the package.
	 * If matchFilenamesWithoutExtension is enabled, this will resolve the path to include the file extension.
	 * For FFmpeg/FFprobe operations, use this instead of fullPath.
	 * When extension matching is enabled, the path is resolved on every call.
	 */
	async getResolvedFullPath(): Promise<string> {
		const fullPath = this.fullPath

		// If matchFilenamesWithoutExtension is disabled, just return the fullPath
		if (!this.worker.agentAPI.config.matchFilenamesWithoutExtension) {
			return fullPath
		}

		// Use worker cache to avoid repeated file system lookups for files in the same directory:
		let files: string[]
		const dir = path.dirname(fullPath)
		try {
			files = await this.worker.cacheData(
				this._type,
				`readDir:${dir}`,
				async () => {
					// Resolve the file with any extension
					return fsReaddir(dir)
				},
				1000 * 10 // 10 seconds, to avoid quickly repeated file system lookups for files in the same directory
			)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				// If the directory itself doesn't exist, the list is empty
				files = []
			} else {
				throw new Error(`Error listing files in "${dir}": ${stringifyError(error, true)}`)
			}
		}
		// Resolve the file with any extension
		const resolution = await resolveFileWithoutExtension(fullPath, files)

		switch (resolution.result) {
			case 'found':
				return resolution.fullPath
			case 'multiple':
				throw new Error(`Multiple files found matching "${fullPath}": ${resolution.matches.join(', ')}`)
			case 'notFound':
				throw new Error(`File not found: "${fullPath}"`)
			case 'error':
				throw new Error(`Error resolving file "${fullPath}": ${stringifyError(resolution.error, true)}`)
		}
	}
	async readFile(fullPath: string): Promise<Buffer> {
		return fsReadFile(fullPath)
	}
	async readFileIfExists(fullPath: string): Promise<Buffer | undefined> {
		try {
			return await this.readFile(fullPath)
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined // File does not exist
			throw e // Some other error
		}
	}
	async writeFile(fullPath: string, content: Buffer): Promise<void> {
		await fsWriteFile(fullPath, content)
	}
	async listFilesInDir(fullPath: string): Promise<
		{
			name: string
			isDirectory: boolean
			lastModified: number
		}[]
	> {
		const files = await fsReaddir(fullPath)

		return Promise.all(
			files.map(async (filename) => {
				const fullFilePath = path.join(fullPath, filename)

				const stat = await fsLstat(fullFilePath)
				const lastModified = Math.max(
					stat.mtimeMs, // modified
					stat.ctimeMs, // created
					stat.birthtimeMs // birthtime (when a file is copied, this changes but the others are kept from the original file)
				)

				return {
					name: filename,
					isDirectory: stat.isDirectory(),
					lastModified: lastModified,
				}
			})
		)
	}
	getFullPath(filePath: string): string {
		filePath = removeBasePath(this.orgFolderPath, filePath)

		return betterPathJoin(this.folderPath, filePath)
	}

	getMetadataPath(filePath: string): string {
		return this.getFullPath(filePath) + '_metadata.json'
	}

	async setupPackagesMonitor(packageContainerExp: PackageContainerExpectation): Promise<MonitorInProgress> {
		const options = packageContainerExp.monitors.packages
		if (!options) throw new Error('Options not set (this should never happen)')

		const monitorInProgress = new MonitorInProgress(
			{
				label: 'Watch for files in folder',
			},
			async () => {
				// Called on stop
				await watcher.stop()
			}
		)
		// Set up a temporary error listener, to catch any errors during setup:
		monitorInProgress.on('error', (internalError: any) => {
			this.worker.logger.error(`setupPackagesMonitor.monitorInProgress: ${JSON.stringify(internalError)}`)
			monitorInProgress._setStatus(StatusCategory.SETUP, StatusCode.BAD, {
				user: 'Internal error',
				tech: `MonitorInProgress error: ${stringifyError(internalError)}`,
			})
		})

		monitorInProgress._setStatus(StatusCategory.SETUP, StatusCode.UNKNOWN, {
			user: 'Setting up file watcher...',
			tech: `Setting up file watcher...`,
		})

		const monitorId = protectString<MonitorId>(
			`${this.worker.agentAPI.config.workerId}_${this.worker.uniqueId}_${Date.now()}`
		)
		const seenFiles = new Map<string, Expectation.Version.FileOnDisk | null>()

		let triggerSendUpdateTimeout: NodeJS.Timeout | null = null
		let triggerSendUpdateIsRunning = false
		let triggerSendUpdateRunAgain = false
		const triggerSendUpdate = () => {
			triggerSendUpdateRunAgain = false
			if (triggerSendUpdateTimeout) {
				clearTimeout(triggerSendUpdateTimeout)
			}
			triggerSendUpdateTimeout = setTimeout(() => {
				triggerSendUpdateTimeout = null

				if (triggerSendUpdateIsRunning) {
					triggerSendUpdateRunAgain = true
					return
				}

				;(async () => {
					triggerSendUpdateIsRunning = true

					const packages: ExpectedPackage.ExpectedPackageMediaFile[] = []

					// eslint-disable-next-line prefer-const
					for (let [filePath, version] of seenFiles.entries()) {
						// Update the version
						if (!version) {
							const fullPath = path.join(this.folderPath, filePath)
							try {
								const stat = await fsStat(fullPath)
								version = this.convertStatToVersion(stat)
								seenFiles.set(filePath, version)

								monitorInProgress._unsetStatus(StatusCategory.FILE + fullPath)
							} catch (err) {
								version = null
								this.worker.logger.error(
									`GenericFileAccessorHandle.setupPackagesMonitor: Unexpected Exception caught: ${stringifyError(
										err
									)}`
								)

								monitorInProgress._setStatus(StatusCategory.FILE + fullPath, StatusCode.BAD, {
									user: 'Error when accessing watched file',
									tech: `Error: ${stringifyError(err)}`,
								})
							}
						}

						if (version) {
							const expPackage: ExpectedPackage.ExpectedPackageMediaFile = {
								_id: protectString<ExpectedPackageId>(`${monitorId}_${filePath}`),
								layers: options.targetLayers,
								contentVersionHash: hashObj(version),
								type: ExpectedPackage.PackageType.MEDIA_FILE,
								content: {
									filePath: filePath,
								},
								version: {
									fileSize: version.fileSize,
									modifiedDate: version.modifiedDate,
								},
								sources: [
									{
										containerId: packageContainerExp.id,
										accessors: {},
									},
								],
								sideEffect: options.sideEffect,
							}
							if (!expPackage.sources[0].accessors) {
								expPackage.sources[0].accessors = {}
							}
							if (this._type === LocalFolderAccessorHandleType) {
								expPackage.sources[0].accessors[this.accessorId] =
									literal<AccessorOnPackage.LocalFolder>({
										type: Accessor.AccessType.LOCAL_FOLDER,
										filePath: filePath,
									})
							} else if (this._type === FileShareAccessorHandleType) {
								expPackage.sources[0].accessors[this.accessorId] = literal<AccessorOnPackage.FileShare>(
									{
										type: Accessor.AccessType.FILE_SHARE,
										filePath: filePath,
									}
								)
							} else {
								assertNever(this._type)
							}

							packages.push(expPackage)
						}
					}

					await this.worker.sendMessageToManager(packageContainerExp.managerId, {
						type: 'reportFromMonitorPackages',
						arguments: [packageContainerExp.id, monitorId, packages],
					})

					if (options.warningLimit && seenFiles.size > options.warningLimit) {
						monitorInProgress._setStatus(StatusCategory.WARNING_LIMIT, StatusCode.WARNING_MAJOR, {
							user: 'Warning: Too many files for monitor',
							tech: `There are ${seenFiles.size} files in the folder, which might cause performance issues. Reduce the number of files to below ${options.warningLimit} to get rid of this warning.`,
						})
					} else {
						monitorInProgress._unsetStatus(StatusCategory.WARNING_LIMIT)
					}

					// Finally
					triggerSendUpdateIsRunning = false
					if (triggerSendUpdateRunAgain) triggerSendUpdate()
				})().catch((err) => {
					triggerSendUpdateIsRunning = false
					this.worker.logger.error(`Error in FileHandler triggerSendUpdate:${stringifyError(err)}`)
					if (triggerSendUpdateRunAgain) triggerSendUpdate()
				})
			}, 1000) // Wait just a little bit, to avoid doing multiple updates
		}

		const watcher: IFileWatcher = new FileWatcher(this.folderPath, {
			ignore: options.ignore,
			awaitWriteFinishStabilityThreshold: options.awaitWriteFinishStabilityThreshold,
		})
		watcher.on('error', (errString: string) => {
			this.worker.logger.error(`GenericFileAccessorHandle.setupPackagesMonitor: watcher.error: ${errString}}`)
			monitorInProgress._setStatus(StatusCategory.WATCHER, StatusCode.BAD, {
				user: 'There was an unexpected error in the file watcher',
				tech: `FileWatcher error: ${stringifyError(errString)}`,
			})
		})
		watcher.on('fileEvent', (fileEvent: FileEvent) => {
			const localPath = watcher.getLocalFilePath(fileEvent.path)

			if (fileEvent.type === 'create' || fileEvent.type === 'update') {
				if (localPath) {
					seenFiles.set(localPath, null) // This will cause triggerSendUpdate() to update the version
					triggerSendUpdate()
				}
			} else if (fileEvent.type === 'delete') {
				// Reset any BAD status related to this file:
				monitorInProgress._unsetStatus(StatusCategory.FILE + fileEvent.path)

				if (localPath) {
					seenFiles.delete(localPath)
					triggerSendUpdate()
				}
			} else {
				assertNever(fileEvent.type)
			}
		})

		// Watch for events:
		await watcher.init()
		triggerSendUpdate()
		monitorInProgress._setStatus(StatusCategory.SETUP, StatusCode.GOOD, {
			user: 'File watcher is set up',
			tech: `File watcher is set up`,
		})

		return monitorInProgress
	}

	public convertStatToVersion(stat: fs.Stats): Expectation.Version.FileOnDisk {
		return {
			type: Expectation.Version.Type.FILE_ON_DISK,
			fileSize: stat.size,
			modifiedDate: stat.mtimeMs,
			// checksum?: string
			// checkSumType?: 'sha' | 'md5' | 'whatever'
		}
	}
}

enum StatusCategory {
	SETUP = 'setup',
	WARNING_LIMIT = 'warningLimit',
	WATCHER = 'watcher',
	FILE = 'file_',
}
