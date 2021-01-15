import * as fs from 'fs'
import { promisify } from 'util'
import { Expectation } from '../../../worker/expectationApi'

const fsAccess = promisify(fs.access)
const fsUnlink = promisify(fs.unlink)

export function compareFileVersion(stat: fs.Stats, version: Expectation.MediaFileVersion): undefined | string {
	let errorReason: string | undefined = undefined

	const statVersion = convertStatToVersion(stat)

	if (version.fileSize && statVersion.fileSize !== version.fileSize) {
		errorReason = `Source file size differ (${version.fileSize}, ${statVersion.fileSize})`
	}
	if (version.modifiedDate && statVersion.modifiedDate !== version.modifiedDate) {
		errorReason = `Source modified date differ (${version.modifiedDate}, ${statVersion.modifiedDate})`
	}
	if (version.checksum) {
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
export async function unlinkIfExists(path: string) {
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
