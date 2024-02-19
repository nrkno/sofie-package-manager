const mod: any = jest.createMockFromModule('mkdirp')

import fsOrg from 'fs'
import { promisify } from 'util'
import type * as fsMockType from '../__mocks__/fs'
const fs = fsOrg as any as typeof fsMockType

const fsStat = promisify(fs.stat)

export async function mkdirp(path: string): Promise<void> {
	try {
		// check if the folder already exists before creating a new one:
		await fsStat(path)
	} catch (err: any) {
		if (err.code !== 'ENOENT') throw err

		fs.__mockSetDirectory(path)
	}
}
mod.mkdirp = mkdirp

module.exports = mod
