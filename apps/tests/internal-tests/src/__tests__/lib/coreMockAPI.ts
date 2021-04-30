import { ExpectedPackage } from '@sofie-automation/blueprints-integration'

export class CoreMockAPI {
	packageInfos: {
		[id: string]: any
	} = {}

	reset() {
		Object.keys(this.packageInfos).forEach((id) => delete this.packageInfos[id])
	}

	async fetchPackageInfoMetadata(
		type: string,
		packageIds: string[]
	): Promise<{ packageId: string; expectedContentVersionHash: string; actualContentVersionHash: string }[]> {
		// This is a mock of the Sofie Core method "fetchPackageInfoMetadata"

		const ids = packageIds.map((packageId) => this.getPackageInfoId(packageId, type))

		const packageInfos: any[] = []
		ids.forEach((id) => {
			if (this.packageInfos[id]) {
				packageInfos.push(this.packageInfos[id])
			}
		})

		return packageInfos.map((packageInfo) => ({
			packageId: packageInfo.packageId,
			expectedContentVersionHash: packageInfo.expectedContentVersionHash,
			actualContentVersionHash: packageInfo.actualContentVersionHash,
		}))
	}
	async updatePackageInfo(
		type: string,
		packageId: string,
		expectedContentVersionHash: string,
		actualContentVersionHash: string,
		payload: any
	): Promise<void> {
		// This is a mock of the Sofie Core method "updatePackageInfo"
		const id = this.getPackageInfoId(packageId, type)

		// upsert:
		this.packageInfos[id] = {
			...(this.packageInfos[id] || {}),

			packageId: packageId,
			expectedContentVersionHash: expectedContentVersionHash,
			actualContentVersionHash: actualContentVersionHash,

			type: type,
			payload: payload,
		}
	}
	async removePackageInfo(type: string, packageId: string): Promise<void> {
		// This is a mock of the Sofie Core method "removePackageInfo"
		const id = this.getPackageInfoId(packageId, type)
		delete this.packageInfos[id]
	}
	async reportFromMonitorPackages(
		_containerId: string,
		_monitorId: string,
		_filePaths: ExpectedPackage.Any[]
	): Promise<void> {
		// todo: implement this in the mock?
	}
	private getPackageInfoId(packageId: string, type: string): string {
		return `${packageId}_${type}`
	}
}
