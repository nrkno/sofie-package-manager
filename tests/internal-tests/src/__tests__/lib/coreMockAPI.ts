import {
	ExpectedPackage,
	ExpectedPackageId,
	MonitorId,
	PackageContainerId,
	ProtectedString,
	protectString,
} from '@sofie-package-manager/api'

export class CoreMockAPI {
	packageInfos: Map<PackageInfoId, PackageInfo> = new Map()

	reset() {
		this.packageInfos.clear()
	}

	async fetchPackageInfoMetadata(
		type: string,
		packageIds: ExpectedPackageId[]
	): Promise<
		{ packageId: ExpectedPackageId; expectedContentVersionHash: string; actualContentVersionHash: string }[]
	> {
		// This is a mock of the Sofie Core method "fetchPackageInfoMetadata"

		const ids = packageIds.map((packageId) => this.getPackageInfoId(packageId, type))

		const packageInfos: PackageInfo[] = []
		ids.forEach((id) => {
			const o = this.packageInfos.get(id)
			if (o) {
				packageInfos.push(o)
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
		packageId: ExpectedPackageId,
		expectedContentVersionHash: string,
		actualContentVersionHash: string,
		payload: any
	): Promise<void> {
		// This is a mock of the Sofie Core method "updatePackageInfo"
		const id = this.getPackageInfoId(packageId, type)

		// upsert:

		this.packageInfos.set(id, {
			...(this.packageInfos.get(id) ?? {}),

			packageId: packageId,
			expectedContentVersionHash: expectedContentVersionHash,
			actualContentVersionHash: actualContentVersionHash,

			type: type,
			payload: payload,
		})
	}
	async removePackageInfo(type: string, packageId: ExpectedPackageId, _removeDelay?: number): Promise<void> {
		// This is a mock of the Sofie Core method "removePackageInfo"
		const id = this.getPackageInfoId(packageId, type)
		this.packageInfos.delete(id)
	}
	async reportFromMonitorPackages(
		_containerId: PackageContainerId,
		_monitorId: MonitorId,
		_filePaths: ExpectedPackage.Any[]
	): Promise<void> {
		// todo: implement this in the mock?
	}
	private getPackageInfoId(packageId: ExpectedPackageId, type: string): PackageInfoId {
		return protectString<PackageInfoId>(`${packageId}_${type}`)
	}
}
type PackageInfoId = ProtectedString<'PackageInfoId', string>
interface PackageInfo {
	packageId: ExpectedPackageId
	expectedContentVersionHash: string
	actualContentVersionHash: string

	type: string
	payload: any
}
