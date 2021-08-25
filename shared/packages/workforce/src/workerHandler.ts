import { Expectation } from '@shared/api'
import { Workforce } from './workforce'

// const UPDATE_INTERVAL = 10 * 1000

/** The WorkerHandler is in charge of spinning up/down Workers */
export class WorkerHandler {
	// private updateTimeout: NodeJS.Timer | null = null
	// private updateAgain = false
	// private updateInterval: NodeJS.Timeout
	// private terminated = false

	// private plannedWorkers: PlannedWorker[] = []
	// private workerCount = 0

	constructor(private workForce: Workforce) {
		// this.updateInterval = setInterval(() => {
		// 	this.triggerUpdate()
		// }, UPDATE_INTERVAL)
	}
	public terminate(): void {
		// clearInterval(this.updateInterval)
		// this.terminated = true
	}
	public async requestResources(exp: Expectation.Any): Promise<boolean> {
		let best: { appContainerId: string; appType: string; cost: number } | null = null
		for (const [appContainerId, appContainer] of Object.entries(this.workForce.appContainers)) {
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
			const appContainer = this.workForce.appContainers[best.appContainerId]
			if (!appContainer) throw new Error(`WorkerHandler: AppContainer "${best.appContainerId}" not found`)

			this.workForce.logger.info(
				`Workforce: Spinning up another worker (${best.appType}) on "${best.appContainerId}"`
			)

			// const newPlannedWorker: PlannedWorker = {
			// 	appContainerId: best.appContainerId,
			// 	appType: best.appType,
			// }
			// this.plannedWorkers.push(newPlannedWorker)

			await appContainer.api.spinUp(best.appType)
			// newPlannedWorker.appId = appId
			return true
		} else {
			return false
		}
	}
	// public triggerUpdate(): void {
	// 	if (this.terminated) return

	// 	if (!this.updateTimeout) {
	// 		this.updateAgain = false
	// 		this.updateTimeout = setTimeout(() => {
	// 			this.update()
	// 				.catch((error) => {
	// 					this.workForce.logger.error(error)
	// 				})
	// 				.finally(() => {
	// 					this.updateTimeout = null
	// 					if (this.updateAgain) this.triggerUpdate()
	// 				})
	// 		}, 500)
	// 	} else {
	// 		this.updateAgain = true
	// 	}
	// }
	// private async update(): Promise<void> {
	// 	// Update this.plannedWorkers
	// 	for (const [appContainerId, appContainer] of Object.entries(this.workForce.appContainers)) {
	// 		for (const runningApp of appContainer.runningApps) {
	// 			const plannedWorker = this.plannedWorkers.find((pw) => pw.appId === runningApp.appId)
	// 			if (!plannedWorker) {
	// 				this.plannedWorkers.push({
	// 					appContainerId: appContainerId,
	// 					appType: runningApp.appType,
	// 					appId: runningApp.appId,
	// 					isInUse: false,
	// 				})
	// 			}
	// 		}
	// 	}

	// 	// This is a temporary stupid implementation,
	// 	// to be reworked later..
	// 	const needs: AppTarget[] = []
	// 	for (let i = 0; i < this.workerCount; i++) {
	// 		needs.push({
	// 			appType: 'worker',
	// 		})
	// 	}
	// 	// Reset plannedWorkers:
	// 	for (const plannedWorker of this.plannedWorkers) {
	// 		plannedWorker.isInUse = false
	// 	}

	// 	// Initial check to see which needs are already fulfilled:
	// 	for (const need of needs) {
	// 		// Do we have anything that fullfills the need?
	// 		for (const plannedWorker of this.plannedWorkers) {
	// 			if (plannedWorker.isInUse) continue

	// 			if (plannedWorker.appType === need.appType) {
	// 				// ^ Later, we'll add more checks here ^
	// 				need.fulfilled = true
	// 				plannedWorker.isInUse = true
	// 				break
	// 			}
	// 		}
	// 	}
	// 	for (const need of needs) {
	// 		if (need.fulfilled) continue

	// 		// See which AppContainers can fullfill our need:
	// 		let found = false
	// 		for (const [appContainerId, appContainer] of Object.entries(this.workForce.appContainers)) {
	// 			if (found) break
	// 			if (!appContainer.initialized) continue

	// 			for (const availableApp of appContainer.availableApps) {
	// 				if (availableApp.appType === need.appType) {
	// 					// Spin up that worker:

	// 					this.workForce.logger.info(
	// 						`Workforce: Spinning up another worker (${availableApp.appType}) on "${appContainerId}"`
	// 					)

	// 					const newPlannedWorker: PlannedWorker = {
	// 						appContainerId: appContainerId,
	// 						appType: availableApp.appType,
	// 						isInUse: true,
	// 					}
	// 					this.plannedWorkers.push(newPlannedWorker)

	// 					const appId = await appContainer.api.spinUp(availableApp.appType)

	// 					newPlannedWorker.appId = appId

	// 					found = true
	// 					break
	// 				}
	// 			}
	// 		}
	// 	}
	// }
}
// interface PlannedWorker {
// 	appType: string
// 	appContainerId: string
// 	appId?: string

// 	isInUse: boolean
// }
// interface AppTarget {
// 	appType: string
// 	fulfilled?: boolean
// }
