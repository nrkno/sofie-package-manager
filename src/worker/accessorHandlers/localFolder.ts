import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle } from './genericHandle'
import { Expectation } from '../expectationApi'

const fsStat = promisify(fs.stat)
const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)

export class LocalFolderAccessorHandle extends GenericAccessorHandle {
	constructor(
		private accessor: AccessorOnPackage.LocalFolder,
		private content: {
			filePath: string
		}
	) {
		super(accessor, content, 'localFolder')
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
		if (!this.filePath) return `File path not set`
		return undefined // all good
	}
	async checkPackageReadAccess(): Promise<string | undefined> {
		try {
			await fsAccess(this.fullPath, fs.constants.R_OK)
			// The file exists
		} catch (err) {
			// File is not readable
			return `Not able to read file: ${err.toString()}`
		}
		return undefined // all good
	}
	async checkPackageWriteAccess(): Promise<string | undefined> {
		try {
			await fsAccess(this.fullPath, fs.constants.W_OK)
			// The file exists
		} catch (err) {
			// File is not readable
			return `Not able to write to file: ${err.toString()}`
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
	async getPackageActualVersion(): Promise<Expectation.Version.MediaFile> {
		const stat = await fsStat(this.fullPath)
		return this.convertStatToVersion(stat)
	}
	async removePackage(): Promise<void> {
		await this.unlinkIfExists(this.fullPath)
	}

	get folderPath(): string {
		if (!this.accessor.folderPath) throw new Error(`LocalFolderAccessor: accessor.folderPath not set!`)
		return this.accessor.folderPath
	}
	get filePath(): string {
		const filePath = this.accessor.filePath || this.content.filePath
		if (!filePath) throw new Error(`LocalFolderAccessor: filePath not set!`)
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
}
