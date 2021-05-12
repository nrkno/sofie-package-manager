import path from 'path'
import { promisify } from 'util'
import fs from 'fs'
import { Expectation, hashObj, literal, PackageContainerExpectation } from '@shared/api'
import chokidar from 'chokidar'
import { GenericWorker } from '../../worker'
import { Accessor, AccessorOnPackage, ExpectedPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle } from '../genericHandle'
import { assertNever } from '../../lib/lib'

export const LocalFolderAccessorHandleType = 'localFolder'
export const FileShareAccessorHandleType = 'fileShare'

const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)
const fsStat = promisify(fs.stat)
const fsWriteFile = promisify(fs.writeFile)
const fsUnlink = promisify(fs.unlink)

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
	async removeDuePackages(): Promise<void> {
		let packagesToRemove = await this.getPackagesToRemove()

		const removedFilePaths: string[] = []
		for (const entry of packagesToRemove) {
			// Check if it is time to remove the package:
			if (entry.removeTime < Date.now()) {
				// it is time to remove this package
				const fullPath = this.getFullPath(entry.filePath)
				const metadataPath = this.getMetadataPath(entry.filePath)

				await this.unlinkIfExists(fullPath)
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
	}
	/** Unlink (remove) a file, if it exists. */
	async unlinkIfExists(filePath: string): Promise<void> {
		let exists = false
		try {
			await fsAccess(filePath, fs.constants.R_OK)
			// The file exists
			exists = true
		} catch (err) {
			// Ignore
		}
		if (exists) await fsUnlink(filePath)
	}
	getFullPath(filePath: string): string {
		return path.join(this.folderPath, filePath)
	}
	getMetadataPath(filePath: string): string {
		return this.getFullPath(filePath) + '_metadata.json'
	}

	setupPackagesMonitor(packageContainerExp: PackageContainerExpectation): void {
		const options = packageContainerExp.monitors.packages
		if (!options) throw new Error('Options not set (this should never happen)')

		const watcher = chokidar.watch(this.folderPath, {
			ignored: options.ignore ? new RegExp(options.ignore) : undefined,

			persistent: true,
		})

		const monitorId = `${this.worker.genericConfig.workerId}_${this.worker.uniqueId}_${Date.now()}`
		const seenFiles = new Map<string, Expectation.Version.FileOnDisk | null>()

		let triggerSendUpdateTimeout: NodeJS.Timeout | null = null
		let triggerSendUpdateIsRunning = false
		const triggerSendUpdate = () => {
			if (triggerSendUpdateTimeout) {
				clearTimeout(triggerSendUpdateTimeout)
			}
			triggerSendUpdateTimeout = setTimeout(() => {
				triggerSendUpdateTimeout = null

				if (triggerSendUpdateIsRunning) {
					triggerSendUpdate() // try again later
				}

				;(async () => {
					triggerSendUpdateIsRunning = true

					const packages: ExpectedPackage.ExpectedPackageMediaFile[] = []

					// eslint-disable-next-line prefer-const
					for (let [filePath, version] of seenFiles.entries()) {
						// Update the version
						if (!version) {
							try {
								const fullPath = path.join(this.folderPath, filePath)
								const stat = await fsStat(fullPath)
								version = this.convertStatToVersion(stat)

								seenFiles.set(filePath, version)
							} catch (err) {
								console.log('error', err)
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
							if (this._type === LocalFolderAccessorHandleType) {
								expPackage.sources[0].accessors[
									this.accessorId
								] = literal<AccessorOnPackage.LocalFolder>({
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

					triggerSendUpdateIsRunning = false
				})().catch((err) => {
					triggerSendUpdateIsRunning = false
					console.log('error', err)
				})
			}, 1000) // Wait just a little bit, to avoid doing multiple updates
		}

		/** Get the local filepath from the fullPath */
		const getFilePath = (fullPath: string): string | undefined => {
			return path.relative(this.folderPath, fullPath)
		}
		watcher
			.on('add', (fullPath) => {
				const localPath = getFilePath(fullPath)
				if (localPath) {
					seenFiles.set(localPath, null)
					triggerSendUpdate()
				}
			})
			.on('unlink', (fullPath) => {
				const localPath = getFilePath(fullPath)
				if (localPath) {
					seenFiles.delete(localPath)
					triggerSendUpdate()
				}
			})
			.on('error', (error) => {
				console.log('error', error)
			})

		/** Persistant store for Monitors */
		const cacheMonitors = this.ensureCache<CacheMonitors>('monitors', {})

		cacheMonitors[monitorId] = {
			watcher: watcher,
		}
	}
	disposePackagesMonitor(): void {
		const monitorId = `${this.worker.genericConfig.workerId}_${this.worker.uniqueId}_${Date.now()}`

		/** Persistant store for Monitors */
		const cacheMonitors = this.ensureCache<CacheMonitors>('monitors', {})

		const monitor = cacheMonitors[monitorId]
		if (monitor) {
			// Stop Chokidar
			monitor.watcher.close()
		}
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

interface CacheMonitors {
	[id: string]: { watcher: chokidar.FSWatcher }
}
