import {
	Expectation,
	ExpectationManagerWorkerAgent,
	PackageContainerExpectation,
	ReturnTypeDisposePackageContainerMonitors,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	ReturnTypeRunPackageContainerCronJob,
	ReturnTypeSetupPackageContainerMonitors,
	WorkerAgentConfig,
} from '@shared/api'
import { GenericWorker, WorkerLocation } from '../../worker'
import { FileCopy } from './expectationHandlers/fileCopy'
import { PackageScan } from './expectationHandlers/packageScan'
import { PackageDeepScan } from './expectationHandlers/packageDeepScan'
import { MediaFileThumbnail } from './expectationHandlers/mediaFileThumbnail'
import { ExpectationHandler } from '../../lib/expectationHandler'
import { IWorkInProgress } from '../../lib/workInProgress'
import { MediaFilePreview } from './expectationHandlers/mediaFilePreview'
import { QuantelClipCopy } from './expectationHandlers/quantelClipCopy'
import * as PackageContainerExpHandler from './packageContainerExpectationHandler'
import { QuantelClipPreview } from './expectationHandlers/quantelClipPreview'
import { QuantelThumbnail } from './expectationHandlers/quantelClipThumbnail'
import { assertNever } from '../../lib/lib'
import { hasFFMpeg, hasFFProbe } from './expectationHandlers/lib/ffmpeg'

/** This is a type of worker that runs on a windows machine */
export class WindowsWorker extends GenericWorker {
	static readonly type = 'windowsWorker'

	public hasFFMpeg = false
	public hasFFProbe = false

	constructor(
		public readonly config: WorkerAgentConfig,
		sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker,
		location: WorkerLocation
	) {
		super(config, location, sendMessageToManager, WindowsWorker.type)
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		try {
			return this.getExpectationHandler(exp).doYouSupportExpectation(exp, this, this)
		} catch (err) {
			// Does not support the type
			return {
				support: false,
				reason: err.toString(),
			}
		}
	}
	async init(): Promise<void> {
		this.hasFFMpeg = !!(await hasFFMpeg())
		this.hasFFProbe = !!(await hasFFProbe())
	}
	getCostFortExpectation(exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation> {
		return this.getExpectationHandler(exp).getCostForExpectation(exp, this, this)
	}
	isExpectationReadyToStartWorkingOn(exp: Expectation.Any): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		return this.getExpectationHandler(exp).isExpectationReadyToStartWorkingOn(exp, this, this)
	}
	isExpectationFullfilled(exp: Expectation.Any, wasFullfilled: boolean): Promise<ReturnTypeIsExpectationFullfilled> {
		return this.getExpectationHandler(exp).isExpectationFullfilled(exp, wasFullfilled, this, this)
	}
	workOnExpectation(exp: Expectation.Any): Promise<IWorkInProgress> {
		return this.getExpectationHandler(exp).workOnExpectation(exp, this, this)
	}
	removeExpectation(exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> {
		return this.getExpectationHandler(exp).removeExpectation(exp, this, this)
	}
	private getExpectationHandler(exp: Expectation.Any): ExpectationHandler {
		switch (exp.type) {
			case Expectation.Type.FILE_COPY:
				return FileCopy
			case Expectation.Type.PACKAGE_SCAN:
				return PackageScan
			case Expectation.Type.PACKAGE_DEEP_SCAN:
				return PackageDeepScan
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail
			case Expectation.Type.MEDIA_FILE_PREVIEW:
				return MediaFilePreview
			case Expectation.Type.QUANTEL_CLIP_COPY:
				return QuantelClipCopy
			case Expectation.Type.QUANTEL_CLIP_THUMBNAIL:
				return QuantelThumbnail
			case Expectation.Type.QUANTEL_CLIP_PREVIEW:
				return QuantelClipPreview
			default:
				assertNever(exp)
				// @ts-expect-error exp.type is never
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}

	doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportPackageContainer> {
		return PackageContainerExpHandler.doYouSupportPackageContainer(packageContainer, this)
	}
	runPackageContainerCronJob(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeRunPackageContainerCronJob> {
		return PackageContainerExpHandler.runPackageContainerCronJob(packageContainer, this)
	}
	setupPackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeSetupPackageContainerMonitors> {
		return PackageContainerExpHandler.setupPackageContainerMonitors(packageContainer, this)
	}
	disposePackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDisposePackageContainerMonitors> {
		return PackageContainerExpHandler.disposePackageContainerMonitors(packageContainer, this)
	}
}
