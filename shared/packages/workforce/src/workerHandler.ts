import {
	Expectation,
	LoggerInstance,
	PackageContainerExpectation,
	AppContainerId,
	AppType,
} from '@sofie-package-manager/api'
import { Workforce } from './workforce'

/** The WorkerHandler is in charge of spinning up/down Workers */
export class WorkerHandler {
	private logger: LoggerInstance

	constructor(logger: LoggerInstance, private workForce: Workforce) {
		this.logger = logger.category('WorkerHandler')
	}
	public terminate(): void {
		// nothing?
	}
	public async requestResourcesForExpectation(exp: Expectation.Any): Promise<boolean> {
		this.logger.debug(`Workforce: Got request for resources for exp "${exp.id}"`)

		let errorReason = `No AppContainers registered`
		let best: { appContainerId: AppContainerId; appType: AppType; cost: number } | null = null
		for (const [appContainerId, appContainer] of this.workForce.appContainers.entries()) {
			this.logger.debug(`Workforce: Asking appContainer "${appContainerId}"`)
			const proposal = await appContainer.api.requestAppTypeForExpectation(exp)
			if (proposal.success) {
				if (!best || proposal.cost < best.cost) {
					best = {
						appContainerId: appContainerId,
						appType: proposal.appType,
						cost: proposal.cost,
					}
				}
			} else {
				errorReason = `AppContainer "${appContainerId}": ${proposal.reason.tech}`
			}
		}

		if (best) {
			this.logger.debug(`Workforce: Selecting appContainer "${best.appContainerId}"`)

			const appContainer = this.workForce.appContainers.get(best.appContainerId)
			if (!appContainer) throw new Error(`WorkerHandler: AppContainer "${best.appContainerId}" not found`)

			this.logger.debug(`Workforce: Spinning up another worker (${best.appType}) on "${best.appContainerId}"`)

			await appContainer.api.spinUp(best.appType)
			return true
		} else {
			this.logger.debug(`Workforce: No resources available for Expectation (reason: ${errorReason})`)
			return false
		}
	}
	public async requestResourcesForPackageContainer(packageContainer: PackageContainerExpectation): Promise<boolean> {
		this.logger.debug(`Workforce: Got request for resources for packageContainer "${packageContainer.id}"`)

		let errorReason = `No AppContainers registered`
		let best: { appContainerId: AppContainerId; appType: AppType; cost: number } | null = null
		for (const [appContainerId, appContainer] of this.workForce.appContainers.entries()) {
			this.logger.debug(`Workforce: Asking appContainer "${appContainerId}"`)
			const proposal = await appContainer.api.requestAppTypeForPackageContainer(packageContainer)
			if (proposal.success) {
				if (!best || proposal.cost < best.cost) {
					best = {
						appContainerId: appContainerId,
						appType: proposal.appType,
						cost: proposal.cost,
					}
				}
			} else {
				errorReason = `AppContainer "${appContainerId}": ${proposal.reason.tech}`
			}
		}
		if (best) {
			this.logger.debug(`Workforce: Selecting appContainer "${best.appContainerId}"`)

			const appContainer = this.workForce.appContainers.get(best.appContainerId)
			if (!appContainer)
				throw new Error(
					`WorkerHandler: (requestResourcesForPackageContainer) AppContainer "${best.appContainerId}" not found`
				)

			this.logger.debug(`Workforce: Spinning up another worker (${best.appType}) on "${best.appContainerId}"`)

			await appContainer.api.spinUp(best.appType)
			return true
		} else {
			this.logger.debug(`Workforce: No resources available for PackageContainer  (reason: ${errorReason})`)
			return false
		}
	}
}
