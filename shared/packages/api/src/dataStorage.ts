import { LoggerInstance } from './logger'

/**
 * The DataStore is a simple key-value store, with support for access locks
 */
export class DataStore {
	private storage = new Map<
		string, // dataId
		{
			/** When this is set, prevents others from reading and writing */
			accessLock: {
				lockId: string
				/** created time [timestamp] */
				created: number
				/** time to live [timestamp] */
				ttl: number
				timeout?: NodeJS.Timeout
			} | null
			tag: string | undefined
			/** The data */
			data: any
		}
	>()
	/** An Access Claim is basically a read-queue for accessing/reading a data-point. */
	private accessClaims = new Map<
		string,
		{
			ttl: number
			resolve: () => void
			reject: (err: unknown) => void
		}[]
	>()
	private lockI = 0
	private _handleClaimsTimeout: NodeJS.Timeout | null = null

	private terminated = false
	private logger: LoggerInstance
	constructor(logger: LoggerInstance, private _timeoutTime = 1000) {
		this.logger = logger.category('DataStore')
	}
	terminate(): void {
		this.terminated = true

		if (this._handleClaimsTimeout) {
			clearTimeout(this._handleClaimsTimeout)
			this._handleClaimsTimeout = null
		}
		this.accessClaims.forEach((claims) => {
			for (const claim of claims) {
				claim.reject(new Error(`DataStore: Terminated`))
			}
			claims.splice(0, 99999)
		})
		this.accessClaims.clear()
	}

	/** Request to aquire a write lock */
	async getWriteLock(
		dataId: string,
		customTimeout?: number,
		tag?: string
	): Promise<{ lockId: string; current: any | undefined }> {
		// Wait for getting access to the data:
		await this._waitForAccess(dataId)
		// Set a write lock:
		if (!this.storage.has(dataId)) {
			this.storage.set(dataId, {
				accessLock: null,
				data: undefined,
				tag: tag,
			})
		}
		const data = this.storage.get(dataId)
		if (!data) throw new Error(`Internal error: No data for "${dataId}"`)

		if (this.lockI >= Number.MAX_SAFE_INTEGER) this.lockI = 0
		const lockId = `write_${this.lockI++}`
		const timeoutDuration = customTimeout ?? this._timeoutTime
		data.accessLock = {
			lockId: lockId,
			created: Date.now(),
			ttl: Date.now() + timeoutDuration,
			// In the case of a timeout, it'll be dealt with asap:
			timeout: setTimeout(() => {
				this._triggerHandleClaims(true)
			}, timeoutDuration + 10),
		}

		return { lockId, current: data.data }
	}
	releaseLock(dataId: string, lockId: string): void {
		const data = this.storage.get(dataId)
		if (!data) return
		if (!data.accessLock) return
		if (data.accessLock.lockId === lockId) {
			if (data.accessLock.timeout) clearTimeout(data.accessLock.timeout)
			data.accessLock = null

			this._triggerHandleClaims(true)
		}
	}
	/** Release all locks for a certain tag */
	releaseLockForTag(tag: string): void {
		this.storage.forEach((value, dataId) => {
			if (value.accessLock && value.tag === tag) {
				this.releaseLock(dataId, value.accessLock.lockId)
			}
		})
	}
	write(dataId: string, lockId: string, writeData: string): void {
		const data = this.storage.get(dataId)
		if (!data) throw new Error(`DataStorage: Error when trying to write data: "${dataId}" not found`)
		if (!data.accessLock)
			throw new Error(`DataStorage: Error when trying to write data: "${dataId}" has no accessLock`)
		if (data.accessLock.lockId !== lockId)
			throw new Error(
				`DataStorage: Error when trying to write data: "${dataId}" lockId mismatch (${data.accessLock.lockId}, ${lockId})`
			)
		if (data.accessLock.ttl < Date.now())
			throw new Error(`DataStorage: Error when trying to write data: "${dataId}" TTL timeout`)

		data.data = writeData
		this.releaseLock(dataId, lockId)
	}
	async read(dataId: string): Promise<any> {
		// Wait for getting access to the data:
		await this._waitForAccess(dataId)

		const data = this.storage.get(dataId)
		if (!data) return undefined
		return data.data
	}

	private async _waitForAccess(dataId: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (!this.accessClaims.has(dataId)) {
				this.accessClaims.set(dataId, [])
			}
			const claims = this.accessClaims.get(dataId)
			if (!claims) throw new Error(`Internal error: No claims for "${dataId}"`)

			claims.push({
				ttl: Date.now() + this._timeoutTime,
				resolve,
				reject,
			})

			this._triggerHandleClaims(true)
		})
	}
	private _triggerHandleClaims(asap?: boolean): void {
		if (this.terminated) return

		let delayTime = 1000
		if (asap) {
			if (this._handleClaimsTimeout) {
				clearTimeout(this._handleClaimsTimeout)
				this._handleClaimsTimeout = null
			}
			delayTime = 1
		}

		if (!this._handleClaimsTimeout) {
			this._handleClaimsTimeout = setTimeout(() => {
				this._handleClaimsTimeout = null

				this._handleClaims()
			}, delayTime)
		}
	}
	private _handleClaims(): void {
		if (this.terminated) return
		/** Set to true to run the check again asap. */
		let runAgain = false

		this.accessClaims.forEach((claims, dataId) => {
			const firstClaim = claims[0]
			if (firstClaim) {
				if (firstClaim.ttl < Date.now()) {
					// The claim has expired..
					firstClaim.reject(new Error(`Timeout when waiting for access to "${dataId}"`))
					claims.shift()

					runAgain = true
				} else {
					//
					const data = this.storage.get(dataId)
					let isWaitingForLock: boolean
					if (data) {
						// Check if there is an active lock?
						if (data.accessLock) {
							// There is a lock

							if (data.accessLock.ttl >= Date.now()) {
								isWaitingForLock = true
							} else {
								// The lock has expired
								this.logger.warn(
									`AccessLock timed out after ${Date.now() - data.accessLock.created} ms "${
										data.accessLock.lockId
									}", claim count: ${claims.length}`
								)
								isWaitingForLock = false
							}
						} else {
							isWaitingForLock = false
						}
					} else {
						// data not found, ie there is no lock:
						isWaitingForLock = false
					}

					if (isWaitingForLock) {
						// do nothing, we'll check again later
					} else {
						firstClaim.resolve()
						claims.shift()
						runAgain = true
					}
				}
			}
		})

		this._triggerHandleClaims(runAgain)
	}
}
