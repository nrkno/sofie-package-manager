import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle, PackageReadInfo, PutPackageHandler } from './genericHandle'
import { hashObj, Expectation } from '@shared/api'
import { GenericWorker } from '../worker'

/** Accessor handle for accessing data store in Core */
export class CorePackageInfoAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'corePackageInfo'
	constructor(
		worker: GenericWorker,
		private accessor: AccessorOnPackage.CorePackageCollection,
		private content: {
			infoType: string // "ffprobe"
		}
	) {
		super(worker, accessor, content, CorePackageInfoAccessorHandle.type)
		this.content
	}
	doYouSupportAccess(): boolean {
		return true // always has access
	}
	checkHandleRead(): string | undefined {
		// Note: We assume that we always have write access here, no need to check this.accessor.allowRead
		return this.checkAccessor()
	}
	checkHandleWrite(): string | undefined {
		// Note: We assume that we always have write access here, no need to check this.accessor.allowWrite
		return this.checkAccessor()
	}
	private checkAccessor(): string | undefined {
		if (this.accessor.type !== Accessor.AccessType.CORE_PACKAGE_INFO) {
			return `CorePackageInfo Accessor type is not CORE_PACKAGE_INFO ("${this.accessor.type}")!`
		}
		return undefined // all good
	}
	async checkPackageReadAccess(): Promise<string | undefined> {
		// todo: add a check here?
		return undefined // all good
	}
	async tryPackageRead(): Promise<string | undefined> {
		// not needed
		return undefined
	}
	async checkPackageContainerWriteAccess(): Promise<string | undefined> {
		// todo: add a check here?
		return undefined // all good
	}
	async getPackageActualVersion(): Promise<Expectation.Version.CorePackageInfo> {
		throw new Error('getPackageActualVersion not applicable for CorePackageInfo')
	}
	async removePackage(): Promise<void> {
		throw new Error('removePackage not applicable for CorePackageInfo')

		// todo: implement
		// await this.removePackageInfo(this.content.infoType, 1234)
	}

	async getPackageReadStream(): Promise<{
		readStream: NodeJS.ReadableStream
		cancel: () => void
	}> {
		throw new Error('CorePackageInfo.getPackageReadStream: Not supported')
	}
	async putPackageStream(_sourceStream: NodeJS.ReadableStream): Promise<PutPackageHandler> {
		throw new Error('CorePackageInfo.pipePackageStream: Not supported')
	}

	async getPackageReadInfo(): Promise<{ readInfo: PackageReadInfo; cancel: () => void }> {
		throw new Error('CorePackageInfo.getPackageReadInfo: Not supported')
	}
	async putPackageInfo(_readInfo: PackageReadInfo): Promise<PutPackageHandler> {
		throw new Error('CorePackageInfo.putPackageInfo: Not supported')
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		throw new Error('fetchMetadata not applicable for CorePackageInfo')
	}
	async updateMetadata(): Promise<void> {
		throw new Error('updateMetadata not applicable for CorePackageInfo')
	}
	async removeMetadata(): Promise<void> {
		throw new Error('removeMetadata not applicable for CorePackageInfo')
	}

	public async findUnUpdatedPackageInfo(
		infoType: string,
		exp: Expectation.Any,
		content: unknown,
		actualSourceVersion: Expectation.Version.Any,
		expectTargetVersion: unknown
	): Promise<{ needsUpdate: boolean; reason: string }> {
		const actualContentVersionHash = this.getActualContentVersionHash(
			content,
			actualSourceVersion,
			expectTargetVersion
		)
		const packageInfos = (await this.worker.sendMessageToManager(exp.managerId, {
			type: 'fetchPackageInfoMetadata',
			arguments: [infoType, exp.fromPackages.map((p) => p.id)],
		})) as {
			packageId: string
			expectedContentVersionHash: string
			actualContentVersionHash: string
		}[]

		for (const fromPackage of exp.fromPackages) {
			const packageInfo = packageInfos.find((p) => p.packageId === fromPackage.id)

			if (!packageInfo) {
				return {
					needsUpdate: true,
					reason: `Package "${fromPackage.id}" not found in PackageInfo store`,
				}
			} else if (packageInfo.expectedContentVersionHash !== fromPackage.expectedContentVersionHash) {
				return {
					needsUpdate: true,
					reason: `Package "${fromPackage.id}" expected version differs in PackageInfo store`,
				}
			} else if (packageInfo.actualContentVersionHash !== actualContentVersionHash) {
				return {
					needsUpdate: true,
					reason: `Package "${fromPackage.id}" actual version differs in PackageInfo store`,
				}
			}
		}

		return {
			needsUpdate: false,
			reason: `All packages in PackageInfo store are in sync`,
		}
	}
	public async updatePackageInfo(
		infoType: string,
		exp: Expectation.Any,
		content: unknown,
		actualSourceVersion: Expectation.Version.Any,
		expectTargetVersion: unknown,
		payload: unknown
	): Promise<void> {
		const actualContentVersionHash = this.getActualContentVersionHash(
			content,
			actualSourceVersion,
			expectTargetVersion
		)

		const ps: Promise<any>[] = []
		for (const fromPackage of exp.fromPackages) {
			ps.push(
				this.worker.sendMessageToManager(exp.managerId, {
					type: 'updatePackageInfo',
					arguments: [
						infoType,
						fromPackage.id,
						fromPackage.expectedContentVersionHash,
						actualContentVersionHash,
						payload,
					],
				})
			)
		}
		await Promise.all(ps)
	}
	public async removePackageInfo(infoType: string, exp: Expectation.Any): Promise<void> {
		// const actualContentVersionHash = this.getActualContentVersionHash(packageContainer, content, actualVersion)

		const ps: Promise<any>[] = []
		for (const fromPackage of exp.fromPackages) {
			ps.push(
				this.worker.sendMessageToManager(exp.managerId, {
					type: 'removePackageInfo',
					arguments: [infoType, fromPackage.id],
				})
			)
		}
		await Promise.all(ps)
	}
	/** Returns a hash that changes whenever the package content+version changes */
	private getActualContentVersionHash(
		content: unknown,
		actualSourceVersion: Expectation.Version.Any,
		expectTargetVersion: unknown
	) {
		return hashObj({
			content,
			sourceVersion: actualSourceVersion,
			targetVersion: expectTargetVersion,
		})
	}
}
