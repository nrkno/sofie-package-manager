import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import {
	GenericAccessorHandle,
	PackageReadInfo,
	PutPackageHandler,
	AccessorHandlerResult,
	SetupPackageContainerMonitorsResult,
} from './genericHandle'
import { hashObj, Expectation, Reason } from '@shared/api'
import { GenericWorker } from '../worker'

/** Accessor handle for accessing data store in Core */
export class CorePackageInfoAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'corePackageInfo'
	// @ts-expect-error unused variable
	private content: null // not used by this class
	// @ts-expect-error unused variable
	private workOptions: Expectation.WorkOptions.RemoveDelay
	constructor(
		worker: GenericWorker,
		accessorId: string,
		private accessor: AccessorOnPackage.CorePackageCollection,
		content: any, // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
		workOptions: any // eslint-disable-line  @typescript-eslint/explicit-module-boundary-types
	) {
		super(worker, accessorId, accessor, content, CorePackageInfoAccessorHandle.type)

		// Verify content data:
		this.content = content // not used by this class
		if (workOptions.removeDelay && typeof workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
		this.workOptions = workOptions
	}
	static doYouSupportAccess(): boolean {
		return true // always has access
	}
	checkHandleRead(): AccessorHandlerResult {
		// Note: We assume that we always have write access here, no need to check this.accessor.allowRead
		return this.checkAccessor()
	}
	checkHandleWrite(): AccessorHandlerResult {
		// Note: We assume that we always have write access here, no need to check this.accessor.allowWrite
		return this.checkAccessor()
	}
	private checkAccessor(): AccessorHandlerResult {
		if (this.accessor.type !== Accessor.AccessType.CORE_PACKAGE_INFO) {
			return {
				success: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `CorePackageInfo Accessor type is not CORE_PACKAGE_INFO ("${this.accessor.type}")!`,
				},
			}
		}
		return { success: true }
	}
	async checkPackageReadAccess(): Promise<AccessorHandlerResult> {
		// todo: add a check here?
		return { success: true }
	}
	async tryPackageRead(): Promise<AccessorHandlerResult> {
		// not needed
		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerResult> {
		// todo: add a check here?
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.CorePackageInfo> {
		throw new Error('getPackageActualVersion not applicable for CorePackageInfo')
	}
	async removePackage(): Promise<void> {
		await this.removeMetadata()
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
	async finalizePackage(): Promise<void> {
		// do nothing
	}

	async fetchMetadata(): Promise<Metadata | undefined> {
		throw new Error('fetchMetadata not applicable for CorePackageInfo')
	}
	async updateMetadata(): Promise<void> {
		throw new Error('updateMetadata not applicable for CorePackageInfo')
	}
	async removeMetadata(): Promise<void> {
		// Not applicable
	}
	async runCronJob(): Promise<AccessorHandlerResult> {
		return {
			success: true,
		} // not applicable
	}
	async setupPackageContainerMonitors(): Promise<SetupPackageContainerMonitorsResult> {
		return {
			success: false,
			reason: {
				user: `There is an internal issue in Package Manager`,
				tech: 'setupPackageContainerMonitors, not supported',
			},
		} // not applicable
	}

	public async findUnUpdatedPackageInfo(
		infoType: string,
		exp: Expectation.Any,
		content: unknown,
		actualSourceVersion: Expectation.Version.Any,
		expectTargetVersion: unknown
	): Promise<{ needsUpdate: false } | { needsUpdate: true; reason: Reason }> {
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
					reason: {
						user: 'Package info needs to be stored',
						tech: `Package "${fromPackage.id}" not found in PackageInfo store`,
					},
				}
			} else if (packageInfo.expectedContentVersionHash !== fromPackage.expectedContentVersionHash) {
				return {
					needsUpdate: true,
					reason: {
						user: 'Package info needs to be updated',
						tech: `Package "${fromPackage.id}" expected version differs in PackageInfo store`,
					},
				}
			} else if (packageInfo.actualContentVersionHash !== actualContentVersionHash) {
				return {
					needsUpdate: true,
					reason: {
						user: 'Package info needs to be re-synced',
						tech: `Package "${fromPackage.id}" actual version differs in PackageInfo store`,
					},
				}
			}
		}

		return {
			needsUpdate: false,
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
		const ps: Promise<any>[] = []
		for (const fromPackage of exp.fromPackages) {
			ps.push(
				this.worker.sendMessageToManager(exp.managerId, {
					type: 'removePackageInfo',
					arguments: [infoType, fromPackage.id, exp.workOptions.removeDelay],
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
