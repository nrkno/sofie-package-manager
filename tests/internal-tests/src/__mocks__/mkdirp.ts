const mod: any = jest.createMockFromModule('mkdirp')

import fsOrg from 'fs'
import type * as fsMockType from '../__mocks__/fs'
const fs = fsOrg as any as typeof fsMockType

export async function mkdirp(path: string): Promise<void> {
	fs.__mockSetDirectory(path)
}
mod.mkdirp = mkdirp

module.exports = mod
