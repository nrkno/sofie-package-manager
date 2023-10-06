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
	Reason,
	stringifyError,
} from '@sofie-package-manager/api'

import { GenericWorker } from '../../worker'

import { GenericAccessorHandle } from '../genericHandle'
import { MonitorInProgress } from '../../lib/monitorInProgress'
import { removeBasePath } from './pathJoin'
import { FileEvent, FileWatcher, IFileWatcher } from './FileWatcher'

export const LocalFolderAccessorHandleType = 'localFolder'
export const FileShareAccessorHandleType = 'fileShare'

const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)
const fsReaddir = promisify(fs.readdir)
const fsRmDir = promisify(fs.rmdir)
const fsStat = promisify(fs.stat)
const fsWriteFile = promisify(fs.writeFile)
const fsUnlink = promisify(fs.unlink)
const fsLstat = promisify(fs.lstat)

/**
 * This class handles things that are common between the Localfolder and FileShare classes
 */
export abstract class GenericFileAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	constructor(
		worker: GenericWorker,
		accessorId: string,
		accessor: AccessorOnPackage.Any,
		content: any, // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
		private _type: typeof LocalFolderAccessorHandleType | typeof FileShareAccessorHandleType
	) {
		super(worker, accessorId, accessor, content, _type)
	}
	/** Path to the PackageContainer, ie the folder */
	protected abstract get folderPath(): string
	protected abstract get orgFolderPath(): string

	/** Schedule the package for later removal */
	async delayPackageRemoval(filePath: string, ttl: number): Promise<void> {
		const packagesToRemove = await this.getPackagesToRemove()

		// Search for a pre-existing entry:
		let found = false
		for (const entry of packagesToRemove) {
			if (entry.filePath === filePath) {
				// extend the TTL if it was found:
				entry.removeTime = Date.now() + ttl

				found = true
				break
			}
		}
		if (!found) {
			packagesToRemove.push({
				filePath: filePath,
				removeTime: Date.now() + ttl,
			})
		}

		await this.storePackagesToRemove(packagesToRemove)
	}
	/** Clear a scheduled later removal of a package */
	async clearPackageRemoval(filePath: string): Promise<void> {
		const packagesToRemove = await this.getPackagesToRemove()

		let found = false
		for (let i = 0; i < packagesToRemove.length; i++) {
			const entry = packagesToRemove[i]
			if (entry.filePath === filePath) {
				packagesToRemove.splice(i, 1)
				found = true
				break
			}
		}
		if (found) {
			await this.storePackagesToRemove(packagesToRemove)
		}
	}
	/** Remove any packages that are due for removal */
	async removeDuePackages(): Promise<Reason | null> {
		let packagesToRemove = await this.getPackagesToRemove()

		const removedFilePaths: string[] = []
		for (const entry of packagesToRemove) {
			// Check if it is time to remove the package:
			if (entry.removeTime < Date.now()) {
				// it is time to remove this package
				const fullPath = this.getFullPath(entry.filePath)
				const metadataPath = this.getMetadataPath(entry.filePath)

				if (await this.unlinkIfExists(fullPath))
					this.worker.logOperation(`Remove due packages: Removed file "${fullPath}"`)
				await this.unlinkIfExists(metadataPath)

				removedFilePaths.push(entry.filePath)
			}
		}

		// Fetch again, to decrease the risk of race-conditions:
		packagesToRemove = await this.getPackagesToRemove()
		let changed = false
		// Remove paths from array:
		for (let i = 0; i < packagesToRemove.length; i++) {
			const entry = packagesToRemove[i]
			if (removedFilePaths.includes(entry.filePath)) {
				packagesToRemove.splice(i, 1)
				changed = true
				break
			}
		}
		if (changed) {
			await this.storePackagesToRemove(packagesToRemove)
		}
		return null
	}
	/** Unlink (remove) a file, if it exists. Returns true if it did exist */
	async unlinkIfExists(filePath: string): Promise<boolean> {
		let exists = false
		try {
			await fsAccess(filePath, fs.constants.R_OK)
			// The file exists
			exists = true
		} catch (err) {
			// Ignore
		}
		if (exists) await fsUnlink(filePath)
		return exists
	}
	getFullPath(filePath: string): string {
		filePath = removeBasePath(this.orgFolderPath, filePath)

		return path.join(this.folderPath, filePath)
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

		const monitorId = `${this.worker.agentAPI.config.workerId}_${this.worker.uniqueId}_${Date.now()}`
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
								_id: `${monitorId}_${filePath}`,
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

	/** Clean up (remove) files older than a certain time */
	public async cleanupOldFiles(
		/** Remove files older than this age (in seconde) */
		cleanFileAge: number
	): Promise<Reason | null> {
		// Check the config. 0 or -1 means it's disabled:
		if (cleanFileAge <= 0) {
			return {
				user: 'Internal error',
				tech: `cleanFileAge is ${cleanFileAge}`,
			}
		}

		const cleanUpDirectory = async (dirPath: string, removeEmptyDir: boolean) => {
			const now = Date.now()
			const files = await fsReaddir(path.join(this.folderPath, dirPath))

			if (files.length === 0) {
				if (removeEmptyDir) {
					const dirFullPath = path.join(this.folderPath, dirPath)
					this.worker.logOperation(`Clean up old files: Remove empty dir "${dirFullPath}"`)
					await fsRmDir(dirFullPath)
				}
			} else {
				for (const fileName of files) {
					const filePath = path.join(dirPath, fileName)
					const fullPath = path.join(this.folderPath, filePath)
					const lStat = await fsLstat(fullPath)
					if (lStat.isDirectory()) {
						await cleanUpDirectory(filePath, true)
					} else {
						const lastModified = Math.max(
							lStat.mtimeMs, // modified
							lStat.ctimeMs, // created
							lStat.birthtimeMs // birthtime (when a file is copied, this changes but the others are kept from the original file)
						)
						const age = Math.floor((now - lastModified) / 1000) // in seconds

						if (age > cleanFileAge) {
							await fsUnlink(fullPath)
							this.worker.logOperation(`Clean up old files: Remove file "${fullPath}" (age: ${age})`)
						}
					}
				}
			}
		}

		try {
			await cleanUpDirectory('', false)
		} catch (error) {
			return {
				user: 'Error when cleaning up files',
				tech: stringifyError(error),
			}
		}
		return null
	}

	/** Full path to the file containing deferred removals */
	private get deferRemovePackagesPath(): string {
		return path.join(this.folderPath, '__removePackages.json')
	}
	/** */
	private async getPackagesToRemove(): Promise<DelayPackageRemovalEntry[]> {
		let packagesToRemove: DelayPackageRemovalEntry[] = []
		try {
			await fsAccess(this.deferRemovePackagesPath, fs.constants.R_OK)
			// The file exists

			const text = await fsReadFile(this.deferRemovePackagesPath, {
				encoding: 'utf-8',
			})
			packagesToRemove = JSON.parse(text)
		} catch (err) {
			// File doesn't exist
			packagesToRemove = []
		}
		return packagesToRemove
	}
	private async storePackagesToRemove(packagesToRemove: DelayPackageRemovalEntry[]): Promise<void> {
		await fsWriteFile(this.deferRemovePackagesPath, JSON.stringify(packagesToRemove))
	}
}

interface DelayPackageRemovalEntry {
	/** Local file path */
	filePath: string
	/** Unix timestamp for when it's clear to remove the file */
	removeTime: number
}

enum StatusCategory {
	SETUP = 'setup',
	WARNING_LIMIT = 'warningLimit',
	WATCHER = 'watcher',
	FILE = 'file_',
}
