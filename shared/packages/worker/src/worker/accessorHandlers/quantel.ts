import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { ClipSearchQuery, QuantelGateway } from 'tv-automation-quantel-gateway-client'
import {
	GenericAccessorHandle,
	PackageReadInfo,
	PackageReadInfoBaseType,
	PackageReadInfoQuantelClip,
	PutPackageHandler,
} from './genericHandle'
import { Expectation, literal } from '@shared/api'
import { GenericWorker } from '../worker'
import { ClipDataSummary, ServerInfo } from 'tv-automation-quantel-gateway-client/dist/quantelTypes'

/** The minimum amount of frames where a clip is minimumly playable */
const MINIMUM_FRAMES = 10

/** Accessor handle for handling clips in a Quantel system */
export class QuantelAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'quantel'
	constructor(
		worker: GenericWorker,
		private accessor: AccessorOnPackage.Quantel,
		private content: {
			guid?: string
			title?: string
		}
	) {
		super(worker, accessor, content, QuantelAccessorHandle.type)
	}
	doYouSupportAccess(): boolean {
		return !this.accessor.networkId || this.worker.location.localNetworkIds.includes(this.accessor.networkId)
	}
	checkHandleRead(): string | undefined {
		if (!this.accessor.allowRead) {
			return `Not allowed to read`
		}
		return this.checkAccessor()
	}
	checkHandleWrite(): string | undefined {
		if (!this.accessor.allowWrite) {
			return `Not allowed to write`
		}
		if (!this.accessor.serverId) {
			return `serverId not set (required for target)`
		}
		return this.checkAccessor()
	}
	private checkAccessor(): string | undefined {
		if (this.accessor.type !== Accessor.AccessType.QUANTEL) {
			return `Quantel Accessor type is not QUANTEL ("${this.accessor.type}")!`
		}
		if (!this.accessor.quantelGatewayUrl) return `Accessor quantelGatewayUrl not set`
		if (!this.accessor.ISAUrls) return `Accessor ISAUrls not set`
		if (!this.accessor.ISAUrls.length) return `Accessor ISAUrls is empty`
		if (!this.content.guid && this.content.title) return `Neither guid or title are set (at least one should be)`

		return undefined // all good
	}
	async checkPackageReadAccess(): Promise<string | undefined> {
		const quantel = await this.getQuantelGateway()

		// Search for a clip that match:
		const clipSummary = await this.searchForLatestClip(quantel)

		if (clipSummary) {
			// There is at least one clip that matches the query
			return undefined // all good
		} else {
			return `Quantel clip "${this.content.guid || this.content.title}" not found`
		}
	}
	async tryPackageRead(): Promise<string | undefined> {
		const quantel = await this.getQuantelGateway()

		const clipSummary = await this.searchForLatestClip(quantel)

		if (!clipSummary) return `No clip found`

		if (!parseInt(clipSummary.Frames, 10)) {
			return `Clip "${clipSummary.ClipGUID}" has no frames`
		}
		if (parseInt(clipSummary.Frames, 10) < MINIMUM_FRAMES) {
			// Check that it is meaningfully playable
			return `Clip "${clipSummary.ClipGUID}" hasn't received enough frames`
		}
		if (!clipSummary.Completed || !clipSummary.Completed.length) {
			return `Clip "${clipSummary.ClipGUID}" is not completed`
		}

		return undefined
	}
	async checkPackageContainerWriteAccess(): Promise<string | undefined> {
		const quantel = await this.getQuantelGateway()

		const server = await quantel.getServer()

		if (!server) throw new Error(`Server ${this.accessor.serverId} not found!`)

		if (!server.pools) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)
		if (!server.pools.length) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)
		if (server.down) throw new Error(`Server ${this.accessor.serverId} is down!`)

		return undefined // all good
	}
	async getPackageActualVersion(): Promise<Expectation.Version.QuantelClip> {
		const quantel = await this.getQuantelGateway()

		const clipSummary = await this.searchForLatestClip(quantel)

		if (clipSummary) {
			return this.convertClipSummaryToVersion(clipSummary)
		} else throw new Error(`Clip not found`)
	}
	async removePackage(): Promise<void> {
		// We don't really do this, instead we let the quantel management delete old clip.
		// Perhaps in the future, we could have an opt-in feature to remove clips?
		return undefined // that's ok
	}

	async getPackageReadStream(): Promise<{ readStream: NodeJS.ReadableStream; cancel: () => void }> {
		throw new Error('Quantel.getPackageReadStream: Not supported')
	}
	async putPackageStream(_sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		throw new Error('Quantel.putPackageStream: Not supported')
	}
	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		const quantel = await this.getQuantelGateway()

		const clipSummary = await this.searchForLatestClip(quantel)

		if (clipSummary) {
			return {
				readInfo: literal<PackageReadInfoQuantelClip>({
					type: PackageReadInfoBaseType.QUANTEL_CLIP,
					version: this.convertClipSummaryToVersion(clipSummary),
					clipId: clipSummary.ClipID,
				}),
				cancel: () => {
					// Nothing
				},
			}
		} else throw new Error(`Clip not found`)
	}
	async putPackageInfo(readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		if (readInfo.type !== PackageReadInfoBaseType.QUANTEL_CLIP) {
			throw new Error(`Quantel.putPackageInfo: unsupported readInfo`)
		}

		const quantel = await this.getQuantelGateway()

		const streamHandler: PutPackageHandler = new PutPackageHandler(() => {
			// Can't be aborted, do nothing
		})

		// Wrapping, to enable the consumer to listen to the streamHandler.emit('close') event.
		setImmediate(() => {
			;(async () => {
				const server = await quantel.getServer()

				if (!server) throw new Error(`Server ${this.accessor.serverId} not found!`)

				if (!server.pools) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)
				if (!server.pools.length) throw new Error(`Server ${this.accessor.serverId} has no disk pools!`)

				// Verify that the clip is of the right version:
				const clipData = await quantel.getClip(readInfo.clipId)
				if (!clipData) throw new Error(`Clip id ${readInfo.clipId} not found`)
				if (clipData.Created !== readInfo.version.created)
					throw new Error(
						`Clip id ${readInfo.clipId} property "Created" doesn't match (${clipData.Created} vs ${readInfo.version.created})`
					)
				const cloneId = clipData.CloneId || clipData.ClipID

				if (cloneId !== readInfo.version.cloneId) {
					throw new Error(
						`Clip id ${readInfo.clipId} property "CloneId" doesn't match (${cloneId} vs ${readInfo.version.cloneId})`
					)
				}

				let copyCreated = false
				// Try to copy onto one of the server pools, and stop trying on first success.
				let copyError: any = null
				for (const pool of server.pools) {
					try {
						// Note: Intra-zone copy only
						await quantel.copyClip(undefined, readInfo.clipId, pool, 8, true)

						copyCreated = true
					} catch (err) {
						copyError = err
					}
					if (copyCreated) break //
				}
				if (!copyCreated) {
					if (copyError) {
						throw copyError
					} else {
						throw new Error(`Unknown error in Quantel.putPackageInfo`)
					}
				}
			})()
				.then(() => {
					streamHandler.emit('close')
				})
				.catch((error) => {
					streamHandler.emit('error', error)
				})
		})

		return streamHandler
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		throw new Error('Quantel.fetchMetadata: Not supported')
	}
	async updateMetadata(_metadata: Metadata): Promise<void> {
		// Not supported, do nothing
	}
	async removeMetadata(): Promise<void> {
		// Not supported, do nothing
	}
	private convertClipSummaryToVersion(clipSummary: ClipDataSummary): Expectation.Version.QuantelClip {
		return {
			type: Expectation.Version.Type.QUANTEL_CLIP,
			cloneId: clipSummary.CloneId || clipSummary.ClipID,
			created: clipSummary.Created,
			frames: parseInt(clipSummary.Frames, 10) || 0,
		}
	}
	private async getQuantelGateway(): Promise<QuantelGateway> {
		let cache = this.worker.accessorCache[this.type] as AccessorQuantelCache

		if (!cache) {
			cache = {
				gateways: {},
			}
			this.worker.accessorCache[this.type] = cache
		}

		// These errors are just for types. User-facing checks are done in this.checkAccessor()
		if (!this.accessor.quantelGatewayUrl) throw new Error('accessor.quantelGatewayUrl is not set')
		if (!this.accessor.ISAUrls) throw new Error('accessor.ISAUrls is not set')
		if (!this.accessor.ISAUrls.length) throw new Error('accessor.ISAUrls array is empty')
		// if (!this.accessor.serverId) throw new Error('accessor.serverId is not set')

		const id = `${this.accessor.quantelGatewayUrl}`

		let gateway: QuantelGateway = cache.gateways[id]

		if (!gateway) {
			gateway = new QuantelGateway()
			await gateway.init(
				this.accessor.quantelGatewayUrl,
				this.accessor.ISAUrls,
				this.accessor.zoneId,
				this.accessor.serverId || 0
			)

			// @todo: this should be emitted somehow:
			gateway.on('error', (e) => console.log(`Quantel.QuantelGateway`, e))
			// @todo: We should be able to emit statuses somehow:
			// gateway.monitorServerStatus(() => {})

			cache.gateways[id] = gateway
		}

		// Verify that the cached gateway matches what we want:
		// The reason for this is that a Quantel gateway is pointed at an ISA-setup on startup,
		// and shouldn't be changed without restarting aftewards.
		// So if you want to have multiple ISA:s, you should spin up multiple Quantel-gateways.
		if (this.accessor.quantelGatewayUrl !== gateway.gatewayUrl)
			throw new Error(
				`Cached QuantelGateway.quantelGatewayUrl doesnt match accessor ("${this.accessor.quantelGatewayUrl}" vs "${gateway.gatewayUrl}")`
			)
		if (this.accessor.ISAUrls.join(',') !== gateway.ISAUrls.join(','))
			throw new Error(
				`Cached QuantelGateway.ISAUrls doesn't match accessor ("${this.accessor.ISAUrls.join(
					','
				)}" vs "${gateway.ISAUrls.join(',')}")`
			)

		return gateway
	}
	/**
	 * Returns the clip to use as source
	 */
	private async searchForLatestClip(quantel: QuantelGateway): Promise<ClipDataSummary | undefined> {
		return (await this.searchForClips(quantel))[0]
	}
	/**
	 * Returns a list of all clips that match the guid or title.
	 * Sorted in the order of Created (latest first)
	 */
	private async searchForClips(quantel: QuantelGateway): Promise<ClipDataSummary[]> {
		let searchQuery: ClipSearchQuery = {}
		if (this.content.guid) {
			searchQuery = {
				ClipGUID: `"${this.content.guid}"`,
			}
		} else if (this.content.title) {
			searchQuery = {
				Title: `"${this.content.title}"`,
			}
		} else throw new Error(`Neither guid nor title set for Quantel clip`)

		let server: ServerInfo | null = null
		if (this.accessor.serverId) server = await quantel.getServer()

		return (await quantel.searchClip(searchQuery))
			.filter((clipData) => {
				return (
					typeof clipData.PoolID === 'number' &&
					(!server || (server.pools || []).indexOf(clipData.PoolID) !== -1) // If present in any of the pools of the server
				)
			})
			.sort(
				(
					a,
					b // Sort Created dates into reverse order
				) => new Date(b.Created).getTime() - new Date(a.Created).getTime()
			)
	}
}

interface AccessorQuantelCache {
	gateways: { [id: string]: QuantelGateway }
}
