import { ClipSearchQuery, QuantelGateway } from 'tv-automation-quantel-gateway-client'
import { ClipDataSummary, ServerInfo, ZoneInfo } from 'tv-automation-quantel-gateway-client/dist/quantelTypes'

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

	async purgeCacheSearchClip(searchQuery: ClipSearchQuery): Promise<ClipDataSummary[]> {
		return this.clearCache('searchClip', [searchQuery]) ?? []
	}
	// searchClip() is used often. By caching it, we reduce the load on the server.
	async searchClip(searchQuery: ClipSearchQuery): Promise<ClipDataSummary[]> {
		return this.ensureInCache('searchClip', [searchQuery], async () => super.searchClip(searchQuery))
	}
	async getZones(): Promise<ZoneInfo[]> {
		return this.ensureInCache('getZones', [], async () => super.getZones())
	}
	// getServer() is used often. By caching it, we reduce the load on the server.
	async getServer(disableCache?: boolean): Promise<ServerInfo | null> {
		return this.ensureInCache('getServer', [disableCache], async () => super.getServer(disableCache))
	}
	private getCacheKey(method: string, args: any[]) {
		return `${method}_${JSON.stringify(args)}`
	}
	private async clearCache(method: string, args: any[]): Promise<any | undefined> {
		const cacheKey = this.getCacheKey(method, args)

		const cached = this._cache.get(cacheKey)
		this._cache.delete(cacheKey)

		return cached ? cached.promise : undefined
	}
	private async ensureInCache<T>(method: string, args: any[], getValueFcn: () => Promise<T>): Promise<T> {
		this.triggerPurgeExpiredFromCache()

		const cacheKey = this.getCacheKey(method, args)

		const cached = this._cache.get(cacheKey)
		if (cached && Date.now() - cached.timestamp < this.cacheExpire) {
			return cached.promise
		} else {
			const promise: Promise<any> = getValueFcn()

			this._cache.set(cacheKey, {
				timestamp: Date.now(),
				promise: promise,
			})
			return promise
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
}

interface CacheEntry {
	timestamp: number
	promise: Promise<any>
}
