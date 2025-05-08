import EventEmitter from 'events'
// eslint-disable-next-line node/no-unpublished-import
import { Q, ClipSearchQuery } from 'tv-automation-quantel-gateway-client' // note: this is a mocked module

import { Agent as HTTPAgent } from 'http'
import { Agent as HTTPSAgent } from 'https'

/* eslint-disable no-console */

const client: any = jest.createMockFromModule('tv-automation-quantel-gateway-client')
const DEBUG_LOG = false
function debugLog(...args: any[]): void {
	if (DEBUG_LOG) console.log(...args)
}

export const mock: QuantelMock = {
	servers: [],
}
client.__mock = mock

interface QuantelMock {
	servers: MockServer[]
}
interface MockServer {
	ident: number
	down: boolean
	pools: MockPool[]
}
interface MockPool {
	id: number
	clips: MockClip[]
}
interface MockClip {
	ClipID: number
	CloneId: number | null
	ClipGUID: string
	Title: string

	Completed: string | null
	Frames: string
}

let mockClipId = 1000

export function resetMock(): void {
	debugLog('RESET MOCK')
	mock.servers = [
		{
			ident: 1000,
			down: false,
			pools: [
				{
					id: 100,
					clips: [
						{
							ClipID: 10,
							ClipGUID: 'abc123',
							Title: 'elephants',
							CloneId: null,
							Completed: '2020-01-01',
							Frames: '1337',
						},
						{
							ClipID: 11,
							ClipGUID: 'abc123-reserved-clip',
							Title: 'i-am-a-reserved-clip',
							CloneId: null,
							Completed: '2020-01-01',
							Frames: '5',
						},
					],
				},
			],
		},
		{
			ident: 1001,
			down: false,
			pools: [
				{
					id: 101,

					clips: [],
				},
			],
		},
	]

	for (const instance of QuantelGatewayInstances) {
		instance.mockCopyCount = 0
	}
}
client.resetMock = resetMock

export function getMock(): QuantelMock {
	return mock
}
client.getMock = getMock

export function getClip(clipId: number): MockClip | undefined {
	for (const server of mock.servers) {
		for (const pool of server.pools) {
			for (const clip of pool.clips) {
				if (clip.ClipID === clipId) {
					return clip
				}
			}
		}
	}
	return undefined
}
client.getClip = resetMock
interface SearchResult {
	server: MockServer
	pool: MockPool
	clip: MockClip
}

export function searchClip(searchQuery: (clip: MockClip) => boolean): SearchResult[] {
	const foundClips: SearchResult[] = []
	for (const server of mock.servers) {
		for (const pool of server.pools) {
			for (const clip of pool.clips) {
				// Disclaimer: This is a very crude mock implementation:

				if (searchQuery(clip)) {
					foundClips.push({
						server,
						pool,
						clip,
					})
					break
				}
			}
		}
	}
	return foundClips
}
client.searchClip = searchClip

export function updateClip(updateFunction: (clip: MockClip) => MockClip | null | undefined): void {
	for (const server of mock.servers) {
		for (const pool of server.pools) {
			const updatedClips: MockClip[] = []
			for (const clip of pool.clips) {
				const updatedClip = updateFunction(clip)

				if (updatedClip === null) continue
				else if (updatedClip === undefined) updatedClips.push(clip)
				else updatedClips.push(updatedClip)
			}
			pool.clips = updatedClips
		}
	}
}
client.updateClip = updateClip

export const QuantelGatewayInstances: QuantelGateway[] = []
client.QuantelGatewayInstances = QuantelGatewayInstances

class QuantelGateway extends EventEmitter {
	public mockCopyCount = 0

	private _gatewayUrl?: string
	private _ISAUrls?: string | string[]
	// private _zoneId?: string | undefined
	public serverId?: number

	constructor() {
		super()
		client.QuantelGatewayInstances.push(this)
	}
	async init(gatewayUrl: string, ISAUrls: string | string[], _zoneId: string | undefined, serverId: number) {
		this._gatewayUrl = gatewayUrl
		this._ISAUrls = ISAUrls
		// this._zoneId = _zoneId
		this.serverId = serverId
	}
	// gateway.on('error'
	get gatewayUrl() {
		return this._gatewayUrl
	}
	get ISAUrls() {
		return this._ISAUrls
	}

	async getServer(): Promise<Q.ServerInfo | null> {
		debugLog('getServer')
		if (!this.serverId) return null
		const s = mock.servers.find((server) => server.ident === this.serverId)
		if (!s) return null

		return {
			type: 'Server',
			...s,
			pools: s.pools.map((p) => p.id),
		}
	}
	async getClip(clipId: number): Promise<Q.ClipData | null> {
		debugLog('getClip', clipId)
		const clip = getClip(clipId)
		if (clip) {
			return {
				...clip,

				// ClipID: clipId, // number;
				// ClipGUID: 'abc123',
				// Title: 'elephants', // string;
				// CloneId: null, // number | null;
				Completed: null, // DateString | null;
				Created: '', // DateString;
				Description: '', // string;
				Frames: '', // string;
				Owner: '', // string;
				PoolID: null, // number | null;

				type: 'ClipData',
				Category: '', // string;
				CloneZone: null, // number | null;
				Destination: null, // number | null;
				Expiry: null, // DateString | null;
				HasEditData: null, // number | null;
				Inpoint: null, // number | null;
				JobID: null, // number | null;
				Modified: null, // string | null;
				NumAudTracks: null, // number | null;
				Number: null, // number | null;
				NumVidTracks: null, // number | null;
				Outpoint: null, // number | null;
				PlaceHolder: false, // boolean;
				PlayAspect: '', // string;
				PublishedBy: '', // string;
				Register: '', // string;
				Tape: '', // string;
				Template: null, // number | null;
				UnEdited: null, // number | null;
				PlayMode: '', // string;
				MosActive: false, // boolean;
				Division: '', // string;
				AudioFormats: '', // string;
				VideoFormats: '', // string;
				Protection: '', // string;
				VDCPID: '', // string;
				PublishCompleted: null, // DateString | null;
			}
		}

		return null
	}
	async copyClip(
		zoneID: number | undefined,
		clipID: number,
		poolID: number,
		_priority?: number,
		_history?: boolean
	): Promise<Q.CloneResult> {
		debugLog('copyClip', zoneID, clipID, poolID)
		// ignoring zoneid for now..

		this.mockCopyCount++

		const clip = getClip(clipID)
		if (!clip) {
			// todo: error message
			throw new Error(`Mock Clip not found!`)
		}

		const toServer = mock.servers.find((server) => {
			return !!server.pools.find((pool) => pool.id === poolID)
		})
		if (!toServer) throw new Error(`Mock: no servers found for pool ${poolID}`)

		const toPool = toServer.pools.find((pool) => pool.id === poolID)
		if (!toPool) throw new Error(`Mock: Pool ${poolID} not found on server`)

		const existingClip = toPool.clips.find((c) => {
			return c.CloneId === clip.CloneId || clip.ClipID
		})
		if (existingClip) {
			debugLog('copyClip: already there')
			// already there:
			return {
				zoneID: zoneID,
				clipID: clipID,
				poolID: poolID,
				priority: _priority,
				history: _history,

				type: 'CloneResult',
				copyID: existingClip.CloneId || existingClip.ClipID,
				copyCreated: false,
			}
		} else {
			const newClip = Object.assign({}, clip)
			newClip.ClipID = mockClipId++
			newClip.CloneId = clip.CloneId || clip.ClipID

			toPool.clips.push(newClip)

			debugLog('copyClip: add', newClip)

			return {
				zoneID: zoneID,
				clipID: clipID,
				poolID: poolID,
				priority: _priority,
				history: _history,

				type: 'CloneResult',
				copyID: newClip.CloneId,
				copyCreated: true,
			}
		}
	}
	async searchClip(searchQuery: ClipSearchQuery): Promise<Q.ClipDataSummary[]> {
		debugLog('searchClip', JSON.stringify(searchQuery))

		return searchClip((clip) => {
			for (const [key, value] of Object.entries<string | number | undefined>(searchQuery)) {
				if (
					// @ts-expect-error no index
					clip[key] === value ||
					// @ts-expect-error no index
					(clip[key] + '').match(new RegExp(value)) ||
					// @ts-expect-error no index
					`"${clip[key]}"` === value
				) {
					return true
				}
			}
			return false
		}).map((result) => {
			return {
				...result.clip,

				type: 'ClipDataSummary',
				Created: '', // DateString;
				Description: '', // string;
				Owner: '', // string;
				PoolID: result.pool.id,
			}
		})
	}

	getHTTPAgents(): Readonly<{
		http: HTTPAgent
		https: HTTPSAgent
	}> {
		return {
			http: { sockets: [] },
			https: { sockets: [] },
		} as any
	}
}
client.QuantelGateway = QuantelGateway

// Finally, do a call to resetMock
resetMock()

module.exports = client
