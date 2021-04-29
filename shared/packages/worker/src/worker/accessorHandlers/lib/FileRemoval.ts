import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'

const fsAccess = promisify(fs.access)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)
const fsUnlink = promisify(fs.unlink)

/**
 * This class handles removal of packages
 * It is used by the Localfodler and FileShare classes
 */
export class FileRemoval {
	constructor(private getFolderPath: () => string) {}
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
		return path.join(this.getFolderPath(), filePath)
	}
	getMetadataPath(filePath: string): string {
		return this.getFullPath(filePath) + '_metadata.json'
	}

	/** Full path to the file containing deferred removals */
	private get deferRemovePackagesPath(): string {
		return path.join(this.getFolderPath(), '__removePackages.json')
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
