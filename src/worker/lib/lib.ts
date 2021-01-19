import * as crypto from 'crypto'
import * as fs from 'fs'
import _ = require('underscore')
import { Expectation } from '../expectationApi'

export function literal<T>(o: T): T {
	return o
}
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function hashObj(obj: any): string {
	if (_.isArray(obj)) {
		const strs: string[] = []
		for (const value of obj) {
			strs.push(hashObj(value))
		}
		return hash(strs.join(','))
	} else if (typeof obj === 'object') {
		// Sort the keys, so that key order doesn't matter:
		const keys = Object.keys(obj).sort((a, b) => {
			if (a > b) return 1
			if (a < b) return -1
			return 0
		})

		const strs: string[] = []
		for (const key of keys) {
			strs.push(hashObj(obj[key]))
		}
		return hash(strs.join('|'))
	} else {
		return obj + ''
	}
}
export function hash(str: string): string {
	const hash = crypto.createHash('sha1')
	return hash.update(str).digest('hex')
}

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
