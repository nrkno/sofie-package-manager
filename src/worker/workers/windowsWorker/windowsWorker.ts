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
		public readonly config: WindowsWorkerConfig,
		sendMessageToManager: MessageFromWorker,
		location: WorkerLocation
	) {
		super(config, location, sendMessageToManager, 'windowsWorker')
	}
	async doYouSupportExpectation(exp: Expectation.Any): Promise<{ support: boolean; reason: string }> {
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
}
