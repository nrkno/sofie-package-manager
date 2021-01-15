import { Accessor, AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import { hashObj } from '../../../worker/lib/lib'
import { Expectation } from '../../expectationApi'

import { GenericWorker, IWorkInProgress } from '../../worker'
import * as MediaFileCopy from './mediaFileCopy'
import * as MediaFileScan from './mediaFileScan'

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
			// Check that we have access to the resource

			const accessSourceResource = this.findResourceWithAccess(exp.startRequirement.sources)
			const accessTargetResource = this.findResourceWithAccess(exp.endRequirement.targets)
			if (accessSourceResource) {
				if (accessTargetResource) {
					return {
						support: true,
						reason: `Has access to source "${accessSourceResource.resource.label}" through accessor "${accessSourceResource.accessorId}" and target "${accessTargetResource.resource.label}" through accessor "${accessTargetResource.accessorId}"`,
					}
				} else {
					return { support: false, reason: `Doesn't have access to any of the target resources` }
				}
			} else {
				return { support: false, reason: `Doesn't have access to any of the source resources` }
			}
		} else if (exp.type === Expectation.Type.MEDIA_FILE_SCAN) {
			const accessSource = this.findResourceWithAccess(exp.startRequirement.sources)
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
			default:
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
	/** Looks through the resources provided and returns the first one we have access to. */
	private findResourceWithAccess(
		resources: PackageContainerOnPackage[]
	): { resource: PackageContainerOnPackage; accessor: AccessorOnPackage.Any; accessorId: string } | undefined {
		for (const resource of resources) {
			for (const [accessorId, accessor] of Object.entries(resource.accessors)) {
				if (
					accessor.type === Accessor.AccessType.LOCAL_FOLDER &&
					(!accessor.resourceId || accessor.resourceId === this.localComputerId)
				) {
					return { resource, accessor, accessorId }
				} else if (
					accessor.type === Accessor.AccessType.FILE_SHARE &&
					(!accessor.networkId || this.localNetworkIds.includes(accessor.networkId))
				) {
					return { resource, accessor, accessorId }
				} else if (
					accessor.type === Accessor.AccessType.MAPPED_DRIVE &&
					(!accessor.networkId || this.localNetworkIds.includes(accessor.networkId))
				) {
					return { resource, accessor, accessorId }
				} else if (accessor.type === Accessor.AccessType.HTTP) {
					return { resource, accessor, accessorId }
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
		resource: Expectation.PackageContainerOnPackageFile,
		content: { filePath: string },
		version: Expectation.MediaFileVersion
	): Promise<string | undefined> {
		const key = hashObj({ resource, content, version })

		console.log('fetch', key, this.tmpStore[key]?.hash)
		return this.tmpStore[key]?.hash || undefined
	}
	async storePackageInfo(
		resource: Expectation.PackageContainerOnPackageFile,
		content: { filePath: string },
		version: Expectation.MediaFileVersion,
		hash: string,
		// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
		record: any
	): Promise<void> {
		const key = hashObj({ resource, content, version })
		console.log('store', key)

		this.tmpStore[key] = {
			hash: hash,
			record: record,
		}
		console.log('Stored', record)
	}
	async removePackageInfo(
		resource: Expectation.PackageContainerOnPackageFile,
		content: { filePath: string },
		version: Expectation.MediaFileVersion
	): Promise<void> {
		const key = hashObj({ resource, content, version })
		console.log('remove', key)

		delete this.tmpStore[key]
	}
}

const corePackageInfoInterface = new TMPCorePackageInfoInterface() // todo
