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

	const existingBatches = updateJSONFileBatches.get(filePath)
	let batches: BatchOperation[]
	if (existingBatches) {
		batches = existingBatches
	} else {
		batches = []
		updateJSONFileBatches.set(filePath, batches)
	}

	// Find a batch operation that is open to accept new callbacks:
	const openBatch = batches.find((batch) => batch.open)

	if (!openBatch) {
		// Start a new batch:

		const newBatch: BatchOperation = {
			open: true,
			callbacks: [cbManipulate],
			promise: updateJSONFile(
				filePath,
				(oldValue: T | undefined) => {
					// At this point, we close the batch, so no more callbacks can be added:
					newBatch.open = false

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
		batches.push(newBatch)

		let caughtError: any = undefined
		try {
			await newBatch.promise
		} catch (e) {
			caughtError = e
		}
		// After finished executing, remove the batch:
		const i = batches.indexOf(newBatch)
		if (i === -1) throw new Error('Internal Error: Batch not found')
		batches.splice(i, 1)

		if (caughtError) throw caughtError
	} else {
		// There is a batch open for new callbacks. Add the callback to the batch:
		openBatch.callbacks.push(cbManipulate)
		await openBatch.promise
	}
}

const updateJSONFileBatches = new Map<string, BatchOperation[]>()
interface BatchOperation {
	/** When true, new callbacks can be added */
	open: boolean
	/** Resolves when the batch operation has finished */
	promise: Promise<void>
	callbacks: ((oldValue: any | undefined) => any | undefined)[]
}

/**
 * Read a JSON file, created by updateJSONFile()
 */
export async function readJSONFile(filePath: string): Promise<
	| {
			str: string
			value: any
	  }
	| undefined
> {
	{
		const str = await readIfExists(filePath)
		if (str !== undefined) {
			return { str, value: str ? JSON.parse(str) : undefined }
		}
	}

	// Second try; Check if there is a temporary file, to use instead?
	{
		const tmpPath = getTmpPath(filePath)

		const str = await readIfExists(tmpPath)
		if (str !== undefined) {
			return { str, value: str ? JSON.parse(str) : undefined }
		}
	}

	return undefined
}

/**
 * A "safe" way to write JSON data to a file. Takes measures to avoid writing corrupt data to a file due to
 * 1. Multiple process writing to the same file (uses a lock file)
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
			const oldValue = await readJSONFile(filePath)

			const newValue = cbManipulate(oldValue?.value)
			const newValueStr = newValue !== undefined ? JSON.stringify(newValue) : ''

			if (oldValue?.str === newValueStr) {
				// do nothing
			} else {
				if (lockCompromisedError) {
					// The lock was compromised. Try again:
					continue
				}

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
