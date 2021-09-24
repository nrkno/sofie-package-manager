import { Expectation, LoggerInstance, PackageContainerExpectation } from '@shared/api'
import { Workforce } from './workforce'

/** The WorkerHandler is in charge of spinning up/down Workers */
export class WorkerHandler {
	private logger: LoggerInstance

	constructor(private workForce: Workforce) {
		this.logger = workForce.logger
	}
	public terminate(): void {
		// nothing?
	}
	public async requestResourcesForExpectation(exp: Expectation.Any): Promise<boolean> {
		let best: { appContainerId: string; appType: string; cost: number } | null = null
		this.logger.debug(`Workforce: Got request for resources for exp "${exp.id}"`)
		for (const [appContainerId, appContainer] of Object.entries(this.workForce.appContainers)) {
			this.logger.debug(`Workforce: Asking appContainer "${appContainerId}"`)
			const proposal = await appContainer.api.requestAppTypeForExpectation(exp)
			if (proposal) {
				if (!best || proposal.cost < best.cost) {
					best = {
						appContainerId: appContainerId,
						appType: proposal.appType,
						cost: proposal.cost,
					}
				}
			}
		}
		if (best) {
			this.logger.debug(`Workforce: Selecting appContainer "${best.appContainerId}"`)

			const appContainer = this.workForce.appContainers[best.appContainerId]
			if (!appContainer) throw new Error(`WorkerHandler: AppContainer "${best.appContainerId}" not found`)

			this.logger.debug(`Workforce: Spinning up another worker (${best.appType}) on "${best.appContainerId}"`)

			await appContainer.api.spinUp(best.appType)
			return true
		} else {
			this.logger.debug(`Workforce: No resources available for Expectation`)
			return false
		}
	}
	public async requestResourcesForPackageContainer(packageContainer: PackageContainerExpectation): Promise<boolean> {
		let best: { appContainerId: string; appType: string; cost: number } | null = null
		this.logger.debug(`Workforce: Got request for resources for packageContainer "${packageContainer.id}"`)
		for (const [appContainerId, appContainer] of Object.entries(this.workForce.appContainers)) {
			this.logger.debug(`Workforce: Asking appContainer "${appContainerId}"`)
			const proposal = await appContainer.api.requestAppTypeForPackageContainer(packageContainer)
			if (proposal) {
				if (!best || proposal.cost < best.cost) {
					best = {
						appContainerId: appContainerId,
						appType: proposal.appType,
						cost: proposal.cost,
					}
				}
			}
		}
		if (best) {
			this.logger.debug(`Workforce: Selecting appContainer "${best.appContainerId}"`)

			const appContainer = this.workForce.appContainers[best.appContainerId]
			if (!appContainer) throw new Error(`WorkerHandler: AppContainer "${best.appContainerId}" not found`)

			this.logger.debug(`Workforce: Spinning up another worker (${best.appType}) on "${best.appContainerId}"`)

			await appContainer.api.spinUp(best.appType)
			return true
		} else {
			this.logger.debug(`Workforce: No resources available for PackageContainer`)
			return false
		}
	}
}
