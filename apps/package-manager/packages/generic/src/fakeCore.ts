/* eslint-disable node/no-extraneous-import */
import { ExternalPeripheralDeviceAPI } from '@sofie-automation/server-core-integration/dist/lib/methods'
import { ExpectedPackageId } from '@sofie-automation/shared-lib/dist/core/model/Ids'
import { LoggerInstance } from '@sofie-package-manager/api'

/** A fake version of some of the Core APIs, used in troubleshooting */
export class FakeCore {
	private logger: LoggerInstance
	constructor(logger: LoggerInstance) {
		this.logger = logger.category('FakeCore')
	}
	get coreMethods(): Pick<
		ExternalPeripheralDeviceAPI,
		| 'fetchPackageInfoMetadata'
		| 'updatePackageInfo'
		| 'removePackageInfo'
		| 'removeAllExpectedPackageWorkStatusOfDevice'
		| 'removeAllPackageContainerPackageStatusesOfDevice'
		| 'removeAllPackageContainerStatusesOfDevice'
	> {
		return {
			fetchPackageInfoMetadata: this.fetchPackageInfoMetadata.bind(this),
			updatePackageInfo: this.updatePackageInfo.bind(this),
			removePackageInfo: this.removePackageInfo.bind(this),
			removeAllExpectedPackageWorkStatusOfDevice: this.removeAllExpectedPackageWorkStatusOfDevice.bind(this),
			removeAllPackageContainerPackageStatusesOfDevice:
				this.removeAllPackageContainerPackageStatusesOfDevice.bind(this),
			removeAllPackageContainerStatusesOfDevice: this.removeAllPackageContainerStatusesOfDevice.bind(this),
		}
	}

	private packageInfoStore = new Map<
		string,
		{
			type: string
			packageId: ExpectedPackageId
			expectedContentVersionHash: string
			actualContentVersionHash: string
			payload: any
			removeTime?: number
		}
	>()

	private async fetchPackageInfoMetadata(
		type: string,
		packageIds: ExpectedPackageId[]
	): ReturnType<ExternalPeripheralDeviceAPI['fetchPackageInfoMetadata']> {
		const metadata: {
			packageId: ExpectedPackageId
			expectedContentVersionHash: string
			actualContentVersionHash: string
		}[] = []

		for (const packageId of packageIds) {
			const id = this._getId(packageId, type)
			const info = this.packageInfoStore.get(id)
			if (info) {
				metadata.push({
					packageId,
					actualContentVersionHash: info.actualContentVersionHash,
					expectedContentVersionHash: info.expectedContentVersionHash,
				})
			}
		}
		return metadata
	}
	private async updatePackageInfo(
		type: string,
		packageId: ExpectedPackageId,
		expectedContentVersionHash: string,
		actualContentVersionHash: string,
		payload: any
	): ReturnType<ExternalPeripheralDeviceAPI['updatePackageInfo']> {
		const id = this._getId(packageId, type)

		this.packageInfoStore.set(id, {
			packageId,
			type,
			actualContentVersionHash,
			expectedContentVersionHash,
			payload,
		})

		this.logger.debug(
			`PackageInfo "${id}" updated: [${actualContentVersionHash}, ${expectedContentVersionHash}] ${JSON.stringify(
				payload
			)}`
		)
	}
	private async removePackageInfo(
		type: string,
		packageId: ExpectedPackageId,
		removeDelay?: number
	): ReturnType<ExternalPeripheralDeviceAPI['removePackageInfo']> {
		const id = this._getId(packageId, type)

		if (removeDelay) {
			const info = this.packageInfoStore.get(id)
			if (info) {
				info.removeTime = Math.min(info.removeTime || Number.MAX_SAFE_INTEGER, Date.now() + removeDelay)
			}
			this.logger.debug(`PackageInfo "${id}" removed (delay: ${removeDelay})`)
		} else {
			this.packageInfoStore.delete(id)
			this.logger.debug(`PackageInfo "${id}" removed`)
		}
	}
	private async removeAllExpectedPackageWorkStatusOfDevice(): ReturnType<
		ExternalPeripheralDeviceAPI['removeAllExpectedPackageWorkStatusOfDevice']
	> {
		return // not implemented
	}
	private async removeAllPackageContainerPackageStatusesOfDevice(): ReturnType<
		ExternalPeripheralDeviceAPI['removeAllPackageContainerPackageStatusesOfDevice']
	> {
		return // not implemented
	}
	private async removeAllPackageContainerStatusesOfDevice(): ReturnType<
		ExternalPeripheralDeviceAPI['removeAllPackageContainerStatusesOfDevice']
	> {
		return // not implemented
	}

	private _getId(packageId: ExpectedPackageId, type: string) {
		return `${packageId}_${type}`
	}
}
