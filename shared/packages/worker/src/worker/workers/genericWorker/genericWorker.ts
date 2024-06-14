import {
	Expectation,
	ExpectationManagerWorkerAgent,
	LoggerInstance,
	PackageContainerExpectation,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeDoYouSupportPackageContainer,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFulfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	ReturnTypeRunPackageContainerCronJob,
	assertNever,
	stringifyError,
	testHtmlRenderer,
} from '@sofie-package-manager/api'
import { BaseWorker, GenericWorkerAgentAPI } from '../../worker'
import { FileCopy } from './expectationHandlers/fileCopy'
import { FileCopyProxy } from './expectationHandlers/fileCopyProxy'
import { PackageScan } from './expectationHandlers/packageScan'
import { PackageDeepScan } from './expectationHandlers/packageDeepScan'
import { PackageLoudnessScan } from './expectationHandlers/packageLoudnessScan'
import { MediaFileThumbnail } from './expectationHandlers/mediaFileThumbnail'
import { ExpectationHandler } from '../../lib/expectationHandler'
import { IWorkInProgress } from '../../lib/workInProgress'
import { MediaFilePreview } from './expectationHandlers/mediaFilePreview'
import { QuantelClipCopy } from './expectationHandlers/quantelClipCopy'
import * as PackageContainerExpHandler from './packageContainerExpectationHandler'
import { QuantelClipPreview } from './expectationHandlers/quantelClipPreview'
import { QuantelThumbnail } from './expectationHandlers/quantelClipThumbnail'
import { testFFMpeg, testFFProbe } from './expectationHandlers/lib/ffmpeg'
import { JsonDataCopy } from './expectationHandlers/jsonDataCopy'
import { SetupPackageContainerMonitorsResult } from '../../accessorHandlers/genericHandle'
import { FileVerify } from './expectationHandlers/fileVerify'
import { RenderHTML } from './expectationHandlers/RenderHTML'

export type ExpectationHandlerGenericWorker = ExpectationHandler<GenericWorker>

/** This is a type of worker that runs on a windows machine */
export class GenericWorker extends BaseWorker {
	static readonly type = 'genericWorker'

	/** Contains the result of testing the FFMpeg executable. null = all is well, otherwise contains error message */
	public testFFMpeg: null | string = 'Not initialized'
	/** Contains the result of testing the FFProbe executable. null = all is well, otherwise contains error message */
	public testFFProbe: null | string = 'Not initialized'
	/** Contains the result of testing the HTMLRenderer executable. null = all is well, otherwise contains error message */
	public testHTMLRenderer: null | string = 'Not initialized'

	private monitor: NodeJS.Timeout | undefined

	constructor(
		logger: LoggerInstance,
		agentAPI: GenericWorkerAgentAPI,
		sendMessageToManager: ExpectationManagerWorkerAgent.MessageFromWorker
	) {
		super(logger.category('GenericWorker'), agentAPI, sendMessageToManager, GenericWorker.type)
		this.logger.debug(`Worker started`)
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<ReturnTypeDoYouSupportExpectation> {
		return this.getExpectationHandler(exp).doYouSupportExpectation(exp, this)
	}
	async init(): Promise<void> {
		await this.checkExecutables()
		this.monitor = setInterval(() => {
			this.checkExecutables().catch((err) => {
				this.logger.error(`Error in checkExecutables: ${stringifyError(err)}`)
			})
		}, 10 * 1000)
		this.logger.debug(`Worker initialized`)
	}
	terminate(): void {
		if (this.monitor) {
			clearInterval(this.monitor)
			delete this.monitor
		}
		this.logger.debug(`Worker terminated`)
	}
	private async checkExecutables() {
		console.log('Checking executables')
		this.testFFMpeg = await testFFMpeg()
		console.log('testFFMpeg', this.testFFMpeg)
		this.testFFProbe = await testFFProbe()
		console.log('testFFProbe', this.testFFProbe)
		this.testHTMLRenderer = await testHtmlRenderer()
		console.log('testHTMLRenderer', this.testHTMLRenderer)
	}
	async getCostFortExpectation(exp: Expectation.Any): Promise<ReturnTypeGetCostFortExpectation> {
		return this.getExpectationHandler(exp).getCostForExpectation(exp, this)
	}
	async isExpectationReadyToStartWorkingOn(
		exp: Expectation.Any
	): Promise<ReturnTypeIsExpectationReadyToStartWorkingOn> {
		return this.getExpectationHandler(exp).isExpectationReadyToStartWorkingOn(exp, this)
	}
	async isExpectationFulfilled(
		exp: Expectation.Any,
		wasFulfilled: boolean
	): Promise<ReturnTypeIsExpectationFulfilled> {
		return this.getExpectationHandler(exp).isExpectationFulfilled(exp, wasFulfilled, this)
	}
	async workOnExpectation(exp: Expectation.Any, progressTimeout: number): Promise<IWorkInProgress> {
		return this.getExpectationHandler(exp).workOnExpectation(exp, this, progressTimeout)
	}
	async removeExpectation(exp: Expectation.Any): Promise<ReturnTypeRemoveExpectation> {
		return this.getExpectationHandler(exp).removeExpectation(exp, this)
	}
	private getExpectationHandler(exp: Expectation.Any): ExpectationHandlerGenericWorker {
		switch (exp.type) {
			case Expectation.Type.FILE_COPY:
				return FileCopy
			case Expectation.Type.FILE_COPY_PROXY:
				return FileCopyProxy
			case Expectation.Type.FILE_VERIFY:
				return FileVerify
			case Expectation.Type.PACKAGE_SCAN:
				return PackageScan
			case Expectation.Type.PACKAGE_DEEP_SCAN:
				return PackageDeepScan
			case Expectation.Type.PACKAGE_LOUDNESS_SCAN:
				return PackageLoudnessScan
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
			case Expectation.Type.JSON_DATA_COPY:
				return JsonDataCopy
			case Expectation.Type.RENDER_HTML:
				return RenderHTML
			default:
				assertNever(exp)
				// @ts-expect-error exp.type is never
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}

	async doYouSupportPackageContainer(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeDoYouSupportPackageContainer> {
		return PackageContainerExpHandler.doYouSupportPackageContainer(packageContainer, this)
	}
	async runPackageContainerCronJob(
		packageContainer: PackageContainerExpectation
	): Promise<ReturnTypeRunPackageContainerCronJob> {
		return PackageContainerExpHandler.runPackageContainerCronJob(packageContainer, this)
	}
	async setupPackageContainerMonitors(
		packageContainer: PackageContainerExpectation
	): Promise<SetupPackageContainerMonitorsResult> {
		return PackageContainerExpHandler.setupPackageContainerMonitors(packageContainer, this)
	}
}
