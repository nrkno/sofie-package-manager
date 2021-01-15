import { Accessor, AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import { hashObj } from '../../../worker/lib/lib'
import { Expectation } from '../../expectationApi'

import { GenericWorker, IWorkInProgress } from '../../worker'
import * as MediaFileCopy from './mediaFileCopy'
import * as MediaFileScan from './mediaFileScan'
import * as MediaFileThumbnail from './mediaFileThumbnail'

/** This is a type of worker that runs locally, close to the location */
export class LocalWorker extends GenericWorker {
	constructor(
		/** The name/identifier of the computer that this runs on */
		private localComputerId?: string,
		/** The names/identifiers of the local network that this has access to */
		private localNetworkIds: string[] = []
	) {
		super()
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<{ support: boolean; reason: string }> {
		if (exp.type === Expectation.Type.MEDIA_FILE_COPY) {
			// Check that we have access to the packageContainer

			const accessSourcePackageContainer = this.findPackageContainerWithAccess(exp.startRequirement.sources)
			const accessTargetPackageContainer = this.findPackageContainerWithAccess(exp.endRequirement.targets)
			if (accessSourcePackageContainer) {
				if (accessTargetPackageContainer) {
					return {
						support: true,
						reason: `Has access to source "${accessSourcePackageContainer.packageContainer.label}" through accessor "${accessSourcePackageContainer.accessorId}" and target "${accessTargetPackageContainer.packageContainer.label}" through accessor "${accessTargetPackageContainer.accessorId}"`,
					}
				} else {
					return { support: false, reason: `Doesn't have access to any of the target packageContainers` }
				}
			} else {
				return { support: false, reason: `Doesn't have access to any of the source packageContainers` }
			}
		} else if (exp.type === Expectation.Type.MEDIA_FILE_SCAN) {
			const accessSource = this.findPackageContainerWithAccess(exp.startRequirement.sources)
			if (accessSource) {
				return { support: true, reason: `Has access to source` }
			} else {
				return { support: false, reason: `Doesn't have access to any of the sources` }
			}
		}
		return {
			support: false,
			reason: `Does not support type="${exp.type}"`,
		}
	}
	isExpectationReadyToStartWorkingOn(exp: Expectation.Any): Promise<{ ready: boolean; reason: string }> {
		switch (exp.type) {
			case Expectation.Type.MEDIA_FILE_COPY:
				return MediaFileCopy.isExpectationReadyToStartWorkingOn(exp)
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan.isExpectationReadyToStartWorkingOn(exp)
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail.isExpectationReadyToStartWorkingOn(exp)
			default:
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
	isExpectationFullfilled(exp: Expectation.Any): Promise<{ fulfilled: boolean; reason: string }> {
		switch (exp.type) {
			case Expectation.Type.MEDIA_FILE_COPY:
				return MediaFileCopy.isExpectationFullfilled(exp)
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan.isExpectationFullfilled(exp, corePackageInfoInterface)
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail.isExpectationFullfilled(exp)
			default:
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
	workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress> {
		switch (exp.type) {
			case Expectation.Type.MEDIA_FILE_COPY:
				return MediaFileCopy.workOnExpectation(exp)
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan.workOnExpectation(exp, corePackageInfoInterface)
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail.workOnExpectation(exp)
			default:
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
	removeExpectation(exp: Expectation.Any): Promise<{ removed: boolean; reason: string }> {
		switch (exp.type) {
			case Expectation.Type.MEDIA_FILE_COPY:
				return MediaFileCopy.removeExpectation(exp)
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan.removeExpectation(exp, corePackageInfoInterface)
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail.removeExpectation(exp)
			default:
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
	/** Looks through the packageContainer provided and returns the first one we have access to. */
	private findPackageContainerWithAccess(
		packageContainers: PackageContainerOnPackage[]
	):
		| { packageContainer: PackageContainerOnPackage; accessor: AccessorOnPackage.Any; accessorId: string }
		| undefined {
		for (const packageContainer of packageContainers) {
			for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
				if (
					accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
					(!accessor.resourceId || accessor.resourceId === this.localComputerId)
				) {
					return { packageContainer: packageContainer, accessor, accessorId }
				} else if (
					accessor.type === Accessor.AccessType.FILE_SHARE &&
					(!accessor.networkId || this.localNetworkIds.includes(accessor.networkId))
				) {
					return { packageContainer: packageContainer, accessor, accessorId }
				} else if (
					accessor.type === Accessor.AccessType.MAPPED_DRIVE &&
					(!accessor.networkId || this.localNetworkIds.includes(accessor.networkId))
				) {
					return { packageContainer: packageContainer, accessor, accessorId }
				} else if (accessor.type === Accessor.AccessType.HTTP) {
					return { packageContainer: packageContainer, accessor, accessorId }
				}
			}
		}
		return undefined
	}
}

export class TMPCorePackageInfoInterface {
	// This is to be moved to Core:
	private tmpStore: { [key: string]: { hash: string; record: any } } = {}

	async fetchPackageInfoHash(
		packageContainer: Expectation.PackageContainerOnPackageFile,
		content: { filePath: string },
		version: Expectation.MediaFileVersion
	): Promise<string | undefined> {
		const key = hashObj({ packageContainer, content, version })

		console.log('fetch', key, this.tmpStore[key]?.hash)
		return this.tmpStore[key]?.hash || undefined
	}
	async storePackageInfo(
		packageContainer: Expectation.PackageContainerOnPackageFile,
		content: { filePath: string },
		version: Expectation.MediaFileVersion,
		hash: string,
		// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
		record: any
	): Promise<void> {
		const key = hashObj({ packageContainer, content, version })
		console.log('store', key)

		this.tmpStore[key] = {
			hash: hash,
			record: record,
		}
		console.log('Stored', record)
	}
	async removePackageInfo(
		packageContainer: Expectation.PackageContainerOnPackageFile,
		content: { filePath: string },
		version: Expectation.MediaFileVersion
	): Promise<void> {
		const key = hashObj({ packageContainer, content, version })
		console.log('remove', key)

		delete this.tmpStore[key]
	}
}

const corePackageInfoInterface = new TMPCorePackageInfoInterface() // todo
