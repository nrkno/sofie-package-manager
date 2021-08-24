import { Workforce } from './workforce'

const UPDATE_INTERVAL = 10 * 1000

/** The WorkerHandler is in charge of spinning up/down Workers */
export class WorkerHandler {
	private updateTimeout: NodeJS.Timer | null = null
	private updateAgain = false
	private updateInterval: NodeJS.Timeout
	private terminated = false

	private workers: PlannedWorker[] = []

	constructor(private workForce: Workforce) {
		this.updateInterval = setInterval(() => {
			this.triggerUpdate()
		}, UPDATE_INTERVAL)
	}
	public terminate(): void {
		clearInterval(this.updateInterval)
		this.terminated = true
	}
	public triggerUpdate(): void {
		if (this.terminated) return

		if (!this.updateTimeout) {
			this.updateAgain = false
			this.updateTimeout = setTimeout(() => {
				this.update()
					.catch((error) => {
						this.workForce.logger.error(error)
					})
					.finally(() => {
						this.updateTimeout = null
						if (this.updateAgain) this.triggerUpdate()
					})
			}, 500)
		} else {
			this.updateAgain = true
		}
	}
	private async update(): Promise<void> {
		// This is a temporary stupid implementation,
		// to be reworked later..
		const needs: AppTarget[] = [
			{
				appType: 'worker',
			},
			{
				appType: 'worker',
			},
			{
				appType: 'worker',
			},
		]
		const haves: PlannedWorker[] = this.workers.map((worker) => {
			return Object.assign({}, worker)
		})

		// Initial check to see which needs are already fulfilled:
		for (const need of needs) {
			// Do we have anything that fullfills the need?
			for (const have of haves) {
				if (have.appType === need.appType) {
					// ^ Later, we'll add more checks here ^
					need.fulfilled = true
				}
			}
		}
		for (const need of needs) {
			if (need.fulfilled) continue

			// See which AppContainers can fullfill our need:
			let found = false
			for (const [appContainerId, appContainer] of Object.entries(this.workForce.appContainers)) {
				if (found) break
				if (!appContainer.initialized) continue

				for (const availableApp of appContainer.availableApps) {
					if (availableApp.appType === need.appType) {
						// Spin up that worker:

						this.workForce.logger.info(
							`Workforce: Spinning up another worker (${availableApp.appType}) on "${appContainerId}"`
						)

						const newPlannedWorker: PlannedWorker = {
							appContainerId: appContainerId,
							appType: availableApp.appType,
						}
						this.workers.push(newPlannedWorker)

						const appId = await appContainer.api.spinUp(availableApp.appType)

						newPlannedWorker.appId = appId

						found = true
						break
					}
				}
			}
		}
	}
}
interface PlannedWorker {
	appType: string
	appContainerId: string
	appId?: string
}
interface AppTarget {
	appType: string
	fulfilled?: boolean
}
