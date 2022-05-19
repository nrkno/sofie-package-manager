import { GenericWorker } from '../../../worker'
import { UniversalVersion, getStandardCost } from '../lib/lib'
import { ExpectationWindowsHandler } from './expectationWindowsHandler'
import {
	Accessor,
	AccessorOnPackage,
	PackageContainerOnPackage,
	Expectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	Reason,
	stringifyError,
} from '@shared/api'
import { IWorkInProgress } from '../../../lib/workInProgress'
import { checkWorkerHasAccessToPackageContainersOnPackage, lookupAccessorHandles, LookupPackageContainer } from './lib'
import { doFileCopyExpectation, isFileFulfilled, isFileReadyToStartWorkingOn } from './lib/file'

/**
 * Copies a file from one of the sources and into the target PackageContainer
 */
export const FileCopy: ExpectationWindowsHandler = {
	doYouSupportExpectation(exp: Expectation.Any, genericWorker: GenericWorker): ReturnTypeDoYouSupportExpectation {
		return checkWorkerHasAccessToPackageContainersOnPackage(genericWorker, {
			sources: exp.startRequirement.sources,
			targets: exp.endRequirement.targets,
		})
	},
	getCostForExpectation: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeGetCostFortExpectation> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		return getStandardCost(exp, worker)
	},
	isExpectationReadyToStartWorkingOn: async (
		exp: Expectation.Any,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupSource = await lookupCopySources(worker, exp)
		const lookupTarget = await lookupCopyTargets(worker, exp)

		return isFileReadyToStartWorkingOn(worker, lookupSource, lookupTarget)
	},
	isExpectationFullfilled: async (
		exp: Expectation.Any,
		_wasFullfilled: boolean,
		worker: GenericWorker
	): Promise<ReturnTypeIsExpectationFullfilled> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		const lookupSource = await lookupCopySources(worker, exp)

		return isFileFulfilled(worker, lookupSource, lookupTarget)
	},
	workOnExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<IWorkInProgress> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Copies the file from Source to Target

		const lookupSource = await lookupCopySources(worker, exp)
		if (!lookupSource.ready) throw new Error(`Can't start working due to source: ${lookupSource.reason.tech}`)

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) throw new Error(`Can't start working due to target: ${lookupTarget.reason.tech}`)

		const workInProgress = await doFileCopyExpectation(exp, lookupSource, lookupTarget)
		if (workInProgress === null) {
			throw new Error(
				`FileCopy.workOnExpectation: Unsupported accessor source-target pair "${lookupSource.accessor.type}"-"${lookupTarget.accessor.type}"`
			)
		} else {
			return workInProgress
		}
	},
	removeExpectation: async (exp: Expectation.Any, worker: GenericWorker): Promise<ReturnTypeRemoveExpectation> => {
		if (!isFileCopy(exp)) throw new Error(`Wrong exp.type: "${exp.type}"`)
		// Remove the file on the location

		const lookupTarget = await lookupCopyTargets(worker, exp)
		if (!lookupTarget.ready) {
			return {
				removed: false,
				reason: {
					user: `Can't access target, due to: ${lookupTarget.reason.user}`,
					tech: `No access to target: ${lookupTarget.reason.tech}`,
				},
			}
		}

		try {
			await lookupTarget.handle.removePackage()
		} catch (err) {
			return {
				removed: false,
				reason: {
					user: `Cannot remove file due to an internal error`,
					tech: `Cannot remove file: ${stringifyError(err)}`,
				},
			}
		}

		return {
			removed: true,
			// reason: `Removed file "${exp.endRequirement.content.filePath}" from target`
		}
	},
}
function isFileCopy(exp: Expectation.Any): exp is Expectation.FileCopy {
	return exp.type === Expectation.Type.FILE_COPY
}

function lookupCopySources(
	worker: GenericWorker,
	exp: Expectation.FileCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.startRequirement.sources,
		exp.endRequirement.content,
		exp.workOptions,
		{
			read: true,
			readPackage: true,
			packageVersion: exp.endRequirement.version,
			customCheck: checkAccessorForQuantelFileflow,
		}
	)
}
function lookupCopyTargets(
	worker: GenericWorker,
	exp: Expectation.FileCopy
): Promise<LookupPackageContainer<UniversalVersion>> {
	return lookupAccessorHandles<UniversalVersion>(
		worker,
		exp.endRequirement.targets,
		exp.endRequirement.content,
		exp.workOptions,
		{
			write: true,
			writePackageContainer: true,
		}
	)
}

function checkAccessorForQuantelFileflow(
	_packageContainer: PackageContainerOnPackage,
	accessorId: string,
	accessor: AccessorOnPackage.Any
): { success: true } | { success: false; reason: Reason } {
	if (accessor.type === Accessor.AccessType.QUANTEL) {
		if (!accessor.fileflowURL) {
			return {
				success: false,
				reason: {
					user: `Accessor "${accessorId}" does not have a FileFlow URL set.`,
					tech: `Accessor "${accessorId}" does not have a FileFlow URL set.`,
				},
			}
		}
	}
	return {
		success: true,
	}
}
