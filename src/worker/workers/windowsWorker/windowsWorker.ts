import { Accessor, AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../../expectationApi'

import { GenericWorker, GenericWorkerConfig, WorkerLocation } from '../../worker'
import { MediaFileCopy } from './expectationHandlers/mediaFileCopy'
import { MediaFileScan } from './expectationHandlers/mediaFileScan'
import { MediaFileThumbnail } from './expectationHandlers/mediaFileThumbnail'
import { ExpectationHandler } from '../../lib/expectationHandler'
import { MessageFromWorker } from '../../../workerAgent'
import { IWorkInProgress } from '../../lib/workInProgress'

/** This is a type of worker that runs on a windows machine */
export class WindowsWorker extends GenericWorker {
	constructor(
		sendMessageToManager: MessageFromWorker,
		/** The name/identifier of the computer that this runs on */
		private localComputerId?: string,
		/** The names/identifiers of the local network that this has access to */
		private localNetworkIds: string[] = []
	) {
		super(sendMessageToManager)
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
		return this.getExpectationHandler(exp).isExpectationReadyToStartWorkingOn(exp, this, this)
	}
	isExpectationFullfilled(exp: Expectation.Any): Promise<{ fulfilled: boolean; reason: string }> {
		return this.getExpectationHandler(exp).isExpectationFullfilled(exp, this, this)
	}
	workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress> {
		return this.getExpectationHandler(exp).workOnExpectation(exp, this, this)
	}
	removeExpectation(exp: Expectation.Any): Promise<{ removed: boolean; reason: string }> {
		return this.getExpectationHandler(exp).removeExpectation(exp, this, this)
	}
	private getExpectationHandler(exp: Expectation.Any): ExpectationHandler {
		switch (exp.type) {
			case Expectation.Type.MEDIA_FILE_COPY:
				return MediaFileCopy
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail
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
