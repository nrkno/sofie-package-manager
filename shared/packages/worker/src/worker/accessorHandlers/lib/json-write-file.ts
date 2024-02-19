import { promises as fs } from 'fs'
import * as LockFile from 'proper-lockfile'

/** Like updateJSONFile() but allow for multiple manipulations to be batched together and executed sequentially */
export async function updateJSONFileBatch<T>(
	filePath: string,
	/**
	 * Callback to modify the JSON value.
	 * @returns The value to write to the file (or undefined to remove the file)
	 */
	cbManipulate: (oldValue: T | undefined) => T | undefined,
	config?: UpdateJSONFileConfig
): Promise<void> {
	// Add manipulator callback to queue:

	const openBatch = updateJSONFileBatches.get(filePath)

	if (!openBatch) {
		// Start a new batch:

		const newBatch: BatchOperation = {
			callbacks: [cbManipulate],
			promise: updateJSONFile(
				filePath,
				(oldValue: T | undefined) => {
					// At this point, no more callbacks can be added, so we close the batch:

					// Guard against this being called multiple times:
					if (updateJSONFileBatches.get(filePath) === newBatch) {
						updateJSONFileBatches.delete(filePath)
					}

					// Execute all callbacks in the batch:
					let value = oldValue
					for (cbManipulate of newBatch.callbacks) {
						value = cbManipulate(value)
					}
					return value
				},
				config
			),
		}
		updateJSONFileBatches.set(filePath, newBatch)

		await newBatch.promise
	} else {
		// There is a batch open for new callbacks. Add the callback to the batch:
		openBatch.callbacks.push(cbManipulate)
		await openBatch.promise
	}
}

const updateJSONFileBatches = new Map<string, BatchOperation>()
interface BatchOperation {
	/** Resolves when the batch operation has finished */
	promise: Promise<void>
	callbacks: ((oldValue: any | undefined) => any | undefined)[]
}

/**
 * Read a JSON file, created by updateJSONFile()
 */
export async function readJSONFile(
	filePath: string,
	logError?: (message: any) => void
): Promise<
	| {
			str: string
			value: any
	  }
	| undefined
> {
	// eslint-disable-next-line no-console
	logError = logError ?? console.error

	try {
		const str = await readIfExists(filePath)
		if (str !== undefined) {
			return { str, value: str ? JSON.parse(str) : undefined }
		}
	} catch (e) {
		// file data is corrupt, log and continue
		logError(e)
	}

	// Second try; Check if there is a temporary file, to use instead?
	try {
		const tmpPath = getTmpPath(filePath)

		const str = await readIfExists(tmpPath)
		if (str !== undefined) {
			return { str, value: str ? JSON.parse(str) : undefined }
		}
	} catch (e) {
		logError(e)
		// file data is corrupt, return undefined then
		return undefined
	}

	return undefined
}

/**
 * A "safe" way to write JSON data to a file. Takes measures to avoid writing corrupt data to a file due to
 * 1. Multiple processes writing to the same file (uses a lock file)
 * 2. Writing corrupt files due to process exit (write to temporary file and rename)
 */
export async function updateJSONFile<T>(
	filePath: string,
	/**
	 * Callback to modify the JSON value.
	 * @returns The value to write to the file (or undefined to remove the file)
	 */
	cbManipulate: (oldValue: T | undefined) => T | undefined,
	config?: UpdateJSONFileConfig
): Promise<void> {
	const RETRY_TIMEOUT = config?.retryTimeout ?? 100
	const RETRY_COUNT = config?.retryCount ?? 10
	const logWarning: (message: string) => void =
		// eslint-disable-next-line no-console
		config?.logWarning ?? ((e) => console.log('Warning in updateJSONFile', e))
	// eslint-disable-next-line no-console
	const logError: (message: any) => void = config?.logError ?? ((e) => console.log('Error in updateJSONFile', e))

	const tmpFilePath = getTmpPath(filePath)
	let lockCompromisedError: Error | undefined = undefined

	// Retry up to 10 times at locking and writing the file:
	for (let i = 0; i < RETRY_COUNT; i++) {
		lockCompromisedError = undefined

		// Get file lock
		let releaseLock: (() => Promise<void>) | undefined = undefined
		try {
			releaseLock = await LockFile.lock(filePath, {
				onCompromised: (err) => {
					// This is called if the lock somehow gets compromised

					logWarning(`Lock compromised: ${err}`)
					lockCompromisedError = err
				},
			})
		} catch (e) {
			if ((e as any).code === 'ENOENT') {
				// The file does not exist. Create an empty file and try again:

				await fs.writeFile(filePath, '')
				continue
			} else if ((e as any).code === 'ELOCKED') {
				// Already locked, try again later:
				await sleep(RETRY_TIMEOUT)
				continue
			} else {
				// Unknown error.
				throw e
			}
		}

		// At this point, we have acquired the lock.
		try {
			// Read and write to the file:
			const oldValue = await readJSONFile(filePath, logError)

			const newValue = cbManipulate(oldValue?.value)
			const newValueStr = newValue !== undefined ? JSON.stringify(newValue) : ''

			if (oldValue?.str === newValueStr) {
				// do nothing
			} else {
				if (lockCompromisedError) {
					// The lock was compromised. Try again:
					continue
				}

				// Note: We can't unlink the file anywhere in here, or other calls to Lockfile can break
				// by overwriting the file with an empty one.

				// Write to a temporary file first, to avoid corrupting the file in case of a process exit:
				await fs.writeFile(tmpFilePath, newValueStr)

				// Rename file:
				await rename(tmpFilePath, filePath)
			}

			// Release the lock:
			if (!lockCompromisedError) await releaseLock()
			// Done, exit the function:
			return
		} catch (e) {
			if ((e as any).code === 'ERELEASED') {
				// Lock was already released. Something must have gone wrong (eg. someone deleted a folder),
				// Log and try again:
				logWarning(`Lock was already released`)
				continue
			} else {
				// Release the lock:
				if (!lockCompromisedError) await releaseLock()
				throw e
			}
		}
	}
	// At this point, the lock failed

	if (lockCompromisedError) {
		logError(`lockCompromisedError: ${lockCompromisedError}`)
	}
	throw new Error(`Failed to lock file "${filePath}" after ${RETRY_COUNT} attempts`)
}

interface UpdateJSONFileConfig {
	/** How long to wait a before trying again, in case of a failed write lock. Defaults to 100 ms. */
	retryTimeout?: number
	/** How many times to wait a before trying again, in case of a failed write lock. Defaults to 10. */
	retryCount?: number

	logWarning?: (message: string) => void
	logError?: (message: any) => void
}

async function sleep(duration: number): Promise<void> {
	return new Promise((r) => setTimeout(r, duration))
}
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
async function rename(from: string, to: string): Promise<void> {
	try {
		await fs.rename(from, to)
	} catch (e) {
		if ((e as any)?.code === 'EPERM') {
			// Permission denied, wait a little bit and try again:
			await sleep(10)

			await fs.rename(from, to)
		} else throw e
	}
}
export function getTmpPath(filePath: string): string {
	return filePath + '.tmp'
}
