import { getTmpPath, updateJSONFile, updateJSONFileBatch } from '../json-write-file'
import { promises as fs } from 'fs'

const FILE_A = 'file_a.json'
async function cleanup() {
	await Promise.all([unlinkIfExists(FILE_A), unlinkIfExists(getLockPath(FILE_A)), unlinkIfExists(getTmpPath(FILE_A))])
}

beforeEach(cleanup)
afterEach(cleanup)

test('updateJSONFile: single write', async () => {
	const cbManipulate = jest.fn(() => {
		return {
			a: 1,
		}
	})
	await updateJSONFile(FILE_A, cbManipulate)

	expect(cbManipulate).toBeCalledTimes(1)
	expect(await readIfExists(FILE_A)).toBe(
		JSON.stringify({
			a: 1,
		})
	)
})

test('updateJSONFile: 2 writes', async () => {
	const cbManipulate = jest.fn((o) => {
		o = o || []
		o.push('a')
		return o
	})

	const p0 = updateJSONFile(FILE_A, cbManipulate)
	await sleep(5)

	const p1 = updateJSONFile(FILE_A, cbManipulate)

	await Promise.all([p0, p1])

	expect(cbManipulate).toBeCalledTimes(2)
	expect(await readIfExists(FILE_A)).toBe(JSON.stringify(['a', 'a']))
})
test('updateJSONFile: 10 writes', async () => {
	const cbManipulate = jest.fn((o) => {
		o = o || []
		o.push('b')
		return o
	})

	const config = {
		retryTimeout: 30,
		retryCount: 3,
	}

	// This should be an impossible tasks, because there will be too many locks, and not enough time to resolve them:

	let error: any
	try {
		await Promise.all([
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
			updateJSONFile(FILE_A, cbManipulate, config),
		])
	} catch (e) {
		error = e
	}
	expect(error + '').toMatch(/Failed to lock file/)

	// Wait for the lock functions to finish retrying:
	await sleep(config.retryTimeout * config.retryCount)
})

test('updateJSONFileBatch: single write', async () => {
	const cbManipulate = jest.fn(() => {
		return {
			b: 1,
		}
	})
	await updateJSONFileBatch(FILE_A, cbManipulate)

	expect(cbManipulate).toBeCalledTimes(1)
	expect(await readIfExists(FILE_A)).toBe(
		JSON.stringify({
			b: 1,
		})
	)
})

test('updateJSONFileBatch: 3 writes', async () => {
	const v = await readIfExists(FILE_A)
	expect(v).toBe(undefined)

	const cbManipulate = jest.fn((o) => {
		o = o || []
		o.push('a')
		return o
	})

	const p0 = updateJSONFileBatch(FILE_A, cbManipulate)
	await sleep(5)

	const p1 = updateJSONFileBatch(FILE_A, cbManipulate)
	const p2 = updateJSONFileBatch(FILE_A, cbManipulate)

	await Promise.all([p0, p1, p2])

	expect(cbManipulate).toBeCalledTimes(3)
	expect(await readIfExists(FILE_A)).toBe(JSON.stringify(['a', 'a', 'a']))
})
test('updateJSONFileBatch: 20 writes', async () => {
	const cbManipulate = jest.fn((o) => {
		o = o || []
		o.push('a')
		return o
	})

	const config = {
		retryTimeout: 30,
		retryCount: 3,
	}

	const ps: Promise<void>[] = []
	let expectResult: string[] = []
	for (let i = 0; i < 20; i++) {
		ps.push(updateJSONFileBatch(FILE_A, cbManipulate, config))
		expectResult.push('a')
	}

	await Promise.all(ps)

	expect(cbManipulate).toBeCalledTimes(20)
	expect(await readIfExists(FILE_A)).toBe(JSON.stringify(expectResult))
})

async function readIfExists(filePath: string): Promise<string | undefined> {
	try {
		return await fs.readFile(filePath, 'utf-8')
	} catch (e) {
		if ((e as any)?.code === 'ENOENT') {
			// not found
			return undefined
		} else throw e
	}
}
async function unlinkIfExists(filePath: string): Promise<void> {
	try {
		await fs.unlink(filePath)
	} catch (e) {
		if ((e as any)?.code === 'ENOENT') {
			// not found, that's okay
		} else throw e
	}
}
function getLockPath(filePath: string): string {
	return filePath + '.lock'
}
function sleep(duration: number): Promise<void> {
	return new Promise((r) => setTimeout(r, duration))
}
