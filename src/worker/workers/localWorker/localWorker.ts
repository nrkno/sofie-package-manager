import { PackageOrigin } from '@sofie-automation/blueprints-integration'
import { hashObj } from '../../../worker/lib/lib'
import { Expectation } from '../../expectationApi'

import { GenericWorker, IWorkInProgress } from '../../worker'
import * as MediaFileCopy from './mediaFileCopy'
import * as MediaFileScan from './mediaFileScan'

/** This is a type of worker that runs locally, close to the location */
export class LocalWorker extends GenericWorker {
	doYouSupportExpectation(exp: Expectation.Any): boolean {
		if (exp.type === Expectation.Type.MEDIA_FILE_COPY || exp.type === Expectation.Type.MEDIA_FILE_SCAN) {
			return true
		}
		return false
	}
	isExpectationReadyToStartWorkingOn(exp: Expectation.Any): Promise<{ ready: boolean; reason?: string }> {
		switch (exp.type) {
			case Expectation.Type.MEDIA_FILE_COPY:
				return MediaFileCopy.isExpectationReadyToStartWorkingOn(exp)
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan.isExpectationReadyToStartWorkingOn(exp)
			default:
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
	isExpectationFullfilled(exp: Expectation.Any): Promise<{ fulfilled: boolean; reason?: string }> {
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
	removeExpectation(exp: Expectation.Any): Promise<{ removed: boolean; reason?: string }> {
		switch (exp.type) {
			case Expectation.Type.MEDIA_FILE_COPY:
				return MediaFileCopy.removeExpectation(exp)
			case Expectation.Type.MEDIA_FILE_SCAN:
				return MediaFileScan.removeExpectation(exp, corePackageInfoInterface)
			default:
				throw new Error(`Unsupported expectation.type "${exp.type}"`)
		}
	}
}

export class TMPCorePackageInfoInterface {
	// This is to be moved to Core:
	private tmpStore: { [key: string]: { hash: string; record: any } } = {}

	async fetchPackageInfoHash(
		location: PackageOrigin.LocalFolder,
		content: { filePath: string },
		version: Expectation.MediaFileVersion
	): Promise<string | undefined> {
		const key = hashObj({ location, content, version })

		console.log('fetch', key, this.tmpStore[key]?.hash)
		return this.tmpStore[key]?.hash || undefined
	}
	async storePackageInfo(
		location: PackageOrigin.LocalFolder,
		content: { filePath: string },
		version: Expectation.MediaFileVersion,
		hash: string,
		record: any
	): Promise<void> {
		const key = hashObj({ location, content, version })
		console.log('store', key)

		this.tmpStore[key] = {
			hash: hash,
			record: record,
		}
		console.log('Stored', record)
	}
	async removePackageInfo(
		location: PackageOrigin.LocalFolder,
		content: { filePath: string },
		version: Expectation.MediaFileVersion
	): Promise<void> {
		const key = hashObj({ location, content, version })
		console.log('remove', key)

		delete this.tmpStore[key]
	}
}

const corePackageInfoInterface = new TMPCorePackageInfoInterface() // todo
