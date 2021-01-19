import { Expectation } from '../expectationApi'
import { GenericWorker } from '../worker'
import { hashObj } from './lib'

export class CorePackageInfoInterface {
	constructor(private worker: GenericWorker) {}

	/** Looks for if there are any stored PackageInfo that is not matching this.getKey(), in which case needs to be updated */
	async findUnUpdatedPackageInfo(
		infoType: string,
		exp: Expectation.Any,
		content: unknown,
		actualVersion: Expectation.MediaFileVersion
	): Promise<{ needsUpdate: boolean; reason: string }> {
		const actualContentVersionHash = this.getActualContentVersionHash(content, actualVersion)
		const packageInfos = (await this.worker.sendMessageToManager({
			type: 'fetchPackageInfoMetadata',
			arguments: [infoType, exp.fromPackages.map((p) => p.id)],
		})) as { packageId: string; expectedContentVersionHash: string; actualContentVersionHash: string }[]

		for (const fromPackage of exp.fromPackages) {
			const packageInfo = packageInfos.find((p) => p.packageId === fromPackage.id)

			if (!packageInfo) {
				return { needsUpdate: true, reason: `Package "${fromPackage.id}" not found in PackageInfo store` }
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
	async updatePackageInfo(
		infoType: string,
		exp: Expectation.Any,
		content: unknown,
		actualVersion: unknown,
		record: unknown
	): Promise<void> {
		const actualContentVersionHash = this.getActualContentVersionHash(content, actualVersion)

		const ps: Promise<any>[] = []
		for (const fromPackage of exp.fromPackages) {
			ps.push(
				this.worker.sendMessageToManager({
					type: 'updatePackageInfo',
					arguments: [
						infoType,
						fromPackage.id,
						fromPackage.expectedContentVersionHash,
						actualContentVersionHash,
						record,
					],
				})
			)
		}
		await Promise.all(ps)
	}
	async removePackageInfo(infoType: string, exp: Expectation.Any): Promise<void> {
		// const actualContentVersionHash = this.getActualContentVersionHash(packageContainer, content, actualVersion)

		const ps: Promise<any>[] = []
		for (const fromPackage of exp.fromPackages) {
			ps.push(
				this.worker.sendMessageToManager({
					type: 'removePackageInfo',
					arguments: [infoType, fromPackage.id],
				})
			)
		}
		await Promise.all(ps)
	}
	/** Returns a hash that changes whenever the package content+version changes */
	private getActualContentVersionHash(content: unknown, actualVersion: unknown) {
		return hashObj({ content, actualVersion })
	}
}
