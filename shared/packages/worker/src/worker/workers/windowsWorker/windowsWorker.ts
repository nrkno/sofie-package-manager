import {
	Expectation,
	ExpectationManagerWorkerAgent,
	ReturnTypeDoYouSupportExpectation,
	ReturnTypeGetCostFortExpectation,
	ReturnTypeIsExpectationFullfilled,
	ReturnTypeIsExpectationReadyToStartWorkingOn,
	ReturnTypeRemoveExpectation,
	WorkerAgentConfig,
} from '@shared/api'
import { GenericWorker, WorkerLocation } from '../../worker'
import { FileCopy } from './expectationHandlers/fileCopy'
import { MediaFileScan } from './expectationHandlers/mediaFileScan'
import { MediaFileDeepScan } from './expectationHandlers/mediaFileDeepScan'
import { MediaFileThumbnail } from './expectationHandlers/mediaFileThumbnail'
import { ExpectationHandler } from '../../lib/expectationHandler'
import { IWorkInProgress } from '../../lib/workInProgress'
import { MediaFilePreview } from './expectationHandlers/mediaFilePreview'
import { QuantelClipCopy } from './expectationHandlers/quantelClipCopy'

/** This is a type of worker that runs on a windows machine */
export class WindowsWorker extends GenericWorker {
	static readonly type = 'windowsWorker'

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
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan
			case Expectation.Type.MEDIA_FILE_DEEP_SCAN:
				return MediaFileDeepScan
			case Expectation.Type.MEDIA_FILE_THUMBNAIL:
				return MediaFileThumbnail
			case Expectation.Type.MEDIA_FILE_PREVIEW:
				return MediaFilePreview
			case Expectation.Type.QUANTEL_CLIP_COPY:
				return QuantelClipCopy
			default:
				// @ts-expect-error exp.type is never
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
}
