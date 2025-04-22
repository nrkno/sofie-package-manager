import {
	AccessorConstructorProps,
	AccessorHandlerCheckHandleBasicResult,
	AccessorHandlerCheckHandleReadResult,
	AccessorHandlerCheckHandleWriteResult,
	AccessorHandlerCheckPackageContainerWriteAccessResult,
	AccessorHandlerCheckPackageReadAccessResult,
	AccessorHandlerRunCronJobResult,
	AccessorHandlerTryPackageReadResult,
	GenericAccessorHandle,
	PackageOperation,
	PackageReadInfo,
	PutPackageHandler,
	SetupPackageContainerMonitorsResult,
} from './genericHandle'
import {
	Accessor,
	AccessorOnPackage,
	hashObj,
	Expectation,
	Reason,
	protectString,
	ExpectedPackageId,
} from '@sofie-package-manager/api'

/**
 * Accessor handle for accessing data store in Sofie Core.
 * Note: To use this AccessorHandle, you have to use the special methods
 * * findUnUpdatedPackageInfo()
 * * updatePackageInfo()
 * * removePackageInfo()
 */
export class CorePackageInfoAccessorHandle<Metadata> extends GenericAccessorHandle<Metadata> {
	static readonly type = 'corePackageInfo'
	// @ts-expect-error unused variable
	private content: null // not used by this class
	// @ts-expect-error unused variable
	private workOptions: Expectation.WorkOptions.RemoveDelay
	private accessor: AccessorOnPackage.CorePackageCollection

	constructor(arg: AccessorConstructorProps<AccessorOnPackage.CorePackageCollection>) {
		super({
			...arg,
			type: CorePackageInfoAccessorHandle.type,
		})

		this.accessor = arg.accessor
		this.content = arg.content // not used by this class

		// Verify content data:
		if (arg.workOptions.removeDelay && typeof arg.workOptions.removeDelay !== 'number')
			throw new Error('Bad input data: workOptions.removeDelay is not a number!')
		this.workOptions = arg.workOptions
	}
	static doYouSupportAccess(): boolean {
		return true // always has access
	}
	get packageName(): string {
		return 'PackageInfo' // Not really supported for this type of accessor
	}
	checkHandleBasic(): AccessorHandlerCheckHandleBasicResult {
		if (this.accessor.type !== Accessor.AccessType.CORE_PACKAGE_INFO) {
			return {
				success: false,
				knownReason: false,
				reason: {
					user: `There is an internal issue in Package Manager`,
					tech: `CorePackageInfo Accessor type is not CORE_PACKAGE_INFO ("${this.accessor.type}")!`,
				},
			}
		}
		return { success: true }
	}
	checkHandleRead(): AccessorHandlerCheckHandleReadResult {
		// Note: We assume that we always have write access here, no need to check this.accessor.allowRead
		return { success: true }
	}
	checkHandleWrite(): AccessorHandlerCheckHandleWriteResult {
		// Note: We assume that we always have write access here, no need to check this.accessor.allowWrite
		return { success: true }
	}
	async checkPackageReadAccess(): Promise<AccessorHandlerCheckPackageReadAccessResult> {
		// todo: add a check here?
		return { success: true }
	}
	async tryPackageRead(): Promise<AccessorHandlerTryPackageReadResult> {
		// not needed
		return { success: true }
	}
	async checkPackageContainerWriteAccess(): Promise<AccessorHandlerCheckPackageContainerWriteAccessResult> {
		// todo: add a check here?
		return { success: true }
	}
	async getPackageActualVersion(): Promise<Expectation.Version.CorePackageInfo> {
		throw new Error('getPackageActualVersion not applicable for CorePackageInfo')
	}
	async removePackage(_reason: string): Promise<void> {
		await this.removeMetadata()

		// todo: implement
		// await this.removePackageInfo(this.content.infoType, 1234)
		// if (removed) this.logOperation(`Remove package: Removed packageInfo "${this.packageName}", ${reason}`)
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
	async prepareForOperation(
		operationName: string,
		source: string | GenericAccessorHandle<any>
	): Promise<PackageOperation> {
		// do nothing
		return this.logWorkOperation(operationName, source, this.packageName)
	}
	async finalizePackage(operation: PackageOperation): Promise<void> {
		// do nothing
		operation.logDone()
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
	async runCronJob(): Promise<AccessorHandlerRunCronJobResult> {
		return {
			success: true,
		} // not applicable
	}
	async setupPackageContainerMonitors(): Promise<SetupPackageContainerMonitorsResult> {
		return {
			success: false,
			knownReason: false,
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
		const packageInfos: {
			packageId: ExpectedPackageId
			expectedContentVersionHash: string
			actualContentVersionHash: string
		}[] =
			(await this.worker.sendMessageToManager(exp.managerId, {
				type: 'fetchPackageInfoMetadata',
				arguments: [infoType, exp.fromPackages.map((p) => protectString<ExpectedPackageId>(p.id))],
			})) || []

		for (const fromPackage of exp.fromPackages) {
			const packageInfo = packageInfos.find(
				(p) => p.packageId === protectString<ExpectedPackageId>(fromPackage.id)
			)

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
			this.logOperation(`Update package info "${fromPackage.id}"`)
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
	public async removePackageInfo(infoType: string, exp: Expectation.Any, reason: string): Promise<void> {
		const ps: Promise<any>[] = []

		for (const fromPackage of exp.fromPackages) {
			this.logOperation(`Remove package info "${fromPackage.id}" (${reason})`)
			ps.push(
				this.worker.sendMessageToManager(exp.managerId, {
					type: 'removePackageInfo',
					arguments: [
						infoType,
						fromPackage.id,
						(exp.workOptions as Expectation.WorkOptions.RemoveDelay).removeDelay,
					],
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
