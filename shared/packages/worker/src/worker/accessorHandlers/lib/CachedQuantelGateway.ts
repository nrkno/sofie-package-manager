import { ClipSearchQuery, QuantelGateway } from 'tv-automation-quantel-gateway-client'
import { ClipDataSummary, ServerInfo } from 'tv-automation-quantel-gateway-client/dist/quantelTypes'

const DEFAULT_CACHE_EXPIRE = 3000

/**
 * This is a wrapper for the QuantelGateway class, adding a caching-layer to
 */
export class CachedQuantelGateway extends QuantelGateway {
	private readonly _cache: Map<string, CacheEntry> = new Map()
	private cacheExpire: number
	private purgeExpiredCacheTimeout: NodeJS.Timeout | null = null

	constructor(
		config?:
			| {
					timeout?: number | undefined
					checkStatusInterval?: number | undefined
					cacheExpire?: number | undefined
			  }
			| undefined
	) {
		super(config)
		this.cacheExpire = config?.cacheExpire ?? DEFAULT_CACHE_EXPIRE
	}
	public purgeCache(): void {
		this._cache.clear()
	}
	// searchClip() is used often. By caching it, we reduce the load on the server.
	async searchClip(searchQuery: ClipSearchQuery): Promise<ClipDataSummary[]> {
		const result = this.queryCache<ClipDataSummary[]>('searchClip', [searchQuery])
		if (result !== undefined) return result

		return this.ensureInCache('searchClip', [searchQuery], super.searchClip(searchQuery))
	}
	// getServer() is used often. By caching it, we reduce the load on the server.
	async getServer(disableCache?: boolean): Promise<ServerInfo | null> {
		const result = this.queryCache<ServerInfo>('getServer', [disableCache])
		if (result !== undefined) return result

		return this.ensureInCache('getServer', [disableCache], super.getServer(disableCache))
	}

	private queryCache<T>(method: string, args: any[]): Promise<T> | undefined {
		const cacheKey = this.getCacheKey(method, args)

		const inCache = this._cache.get(cacheKey)

		// cache miss
		if (inCache === undefined) return undefined

		// cache stale
		const entryExpires = inCache.timestamp + this.cacheExpire
		if (entryExpires < Date.now()) {
			this._cache.delete(cacheKey)
			return undefined
		}

		if (inCache.result.state === 'rejected') {
			return Promise.reject(inCache.result.err)
		} else {
			return Promise.resolve(inCache.result.value)
		}
	}

	private triggerPurgeExpiredFromCache() {
		// Schedule a purging of expired packages
		if (!this.purgeExpiredCacheTimeout) {
			this.purgeExpiredCacheTimeout = setTimeout(() => {
				this.purgeExpiredCacheTimeout = null
				this.purgeExpiredFromCache()
			}, this.cacheExpire + 100)
		}
	}
	private purgeExpiredFromCache() {
		const expiredKeys: string[] = []
		this._cache.forEach((value, key) => {
			if (value.timestamp >= Date.now() - this.cacheExpire) return
			expiredKeys.push(key)
		})

		for (const key of expiredKeys) {
			this._cache.delete(key)
		}
	}

	private async ensureInCache<T>(method: string, args: any[], answer: Promise<T>): Promise<T> {
		this.triggerPurgeExpiredFromCache()

		const cacheKey = this.getCacheKey(method, args)

		try {
			const result = await answer
			this._cache.set(cacheKey, {
				timestamp: Date.now(),
				result: {
					state: 'resolved',
					value: result,
				},
			})
			return result
		} catch (e) {
			this._cache.set(cacheKey, {
				timestamp: Date.now(),
				result: {
					state: 'rejected',
					err: e,
				},
			})
			return Promise.reject(e)
		}
	}

	private getCacheKey(method: string, args: any[]) {
		return `${method}_${JSON.stringify(args)}`
	}
}

interface CacheEntry {
	timestamp: number
	result:
		| {
				state: 'rejected'
				err: any
		  }
		| {
				state: 'resolved'
				value: any
		  }
}
