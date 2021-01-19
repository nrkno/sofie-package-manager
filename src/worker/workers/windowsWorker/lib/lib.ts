import * as fs from 'fs'
import { promisify } from 'util'
import { Expectation } from '../../../expectationApi'

const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)

export function compareFileVersion(
	actualVersion: Expectation.MediaFileVersion,
	expectVersion: Expectation.MediaFileVersion
): undefined | string {
	let errorReason: string | undefined = undefined

	if (expectVersion.fileSize && actualVersion.fileSize !== expectVersion.fileSize) {
		errorReason = `Source file size differ (${expectVersion.fileSize}, ${actualVersion.fileSize})`
	}
	if (expectVersion.modifiedDate && actualVersion.modifiedDate !== expectVersion.modifiedDate) {
		errorReason = `Source modified date differ (${expectVersion.modifiedDate}, ${actualVersion.modifiedDate})`
	}
	if (expectVersion.checksum) {
		// TODO
		throw new Error('Checksum not implemented yet')
	}
	return errorReason
}
export function convertStatToVersion(stat: fs.Stats): Expectation.MediaFileVersion {
	return {
		fileSize: stat.size,
		modifiedDate: stat.mtimeMs * 1000,
		// checksum?: string
		// checkSumType?: 'sha' | 'md5' | 'whatever'
	}
}
export async function unlinkIfExists(path: string): Promise<void> {
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
