import { ClipSearchQuery, QuantelGateway } from 'tv-automation-quantel-gateway-client'
import {
	ClipData,
	ClipDataSummary,
	ConnectionDetails,
	ServerInfo,
	ZoneInfo,
} from 'tv-automation-quantel-gateway-client/dist/quantelTypes'

const DEFAULT_CACHE_EXPIRE = 3000
const PURGE_CACHE_INTERVAL = 60 * 1000

export class CachedQuantelGateway extends QuantelGateway {
	private readonly _cache: Map<string, CacheEntry> = new Map()
	private cacheExpire: number

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
		setInterval(() => this.purgeCache(), PURGE_CACHE_INTERVAL)
	}
	async connectToISA(ISAUrls: string | string[]): Promise<ConnectionDetails> {
		const result = this.queryCache<ConnectionDetails>('connectToISA', [ISAUrls])
		if (result !== undefined) return result

		return this.ensureInCache('connectToISA', [ISAUrls], super.connectToISA(ISAUrls))
	}
	async getClip(clipId: number): Promise<ClipData | null> {
		const result = this.queryCache<ClipData>('getClip', [clipId])
		if (result !== undefined) return result

		return this.ensureInCache('getClip', [clipId], super.getClip(clipId))
	}
	async searchClip(searchQuery: ClipSearchQuery): Promise<ClipDataSummary[]> {
		const result = this.queryCache<ClipDataSummary[]>('searchClip', [searchQuery])
		if (result !== undefined) return result

		return this.ensureInCache('searchClip', [searchQuery], super.searchClip(searchQuery))
	}
	async getZones(): Promise<ZoneInfo[]> {
		const result = this.queryCache<ZoneInfo[]>('getZones', [])
		if (result !== undefined) return result

		return this.ensureInCache('getZones', [], super.getZones())
	}
	async getServer(disableCache?: boolean): Promise<ServerInfo | null> {
		const result = this.queryCache<ServerInfo>('getServer', [disableCache])
		if (result !== undefined) return result

		return this.ensureInCache('getServer', [disableCache], super.getServer(disableCache))
	}
	async getServers(zoneId?: string): Promise<ServerInfo[]> {
		const result = this.queryCache<ServerInfo[]>('getServers', [zoneId])
		if (result !== undefined) return result

		return this.ensureInCache('getServers', [zoneId], super.getServers(zoneId))
	}

	private queryCache<T>(method: string, args: any[]): Promise<T> | undefined {
		const cacheKey = this.getCacheKey(method, args)

		const inCache = this._cache.get(cacheKey)

		// cache miss
		if (inCache === undefined) return undefined

		// cache stale
		if (inCache.timestamp < Date.now() - this.cacheExpire) {
			this._cache.delete(cacheKey)
			return undefined
		}

		if (inCache.result.state === 'rejected') {
			return Promise.reject(inCache.result.err)
		} else {
			return Promise.resolve(inCache.result.value)
		}
	}

	private purgeCache() {
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
