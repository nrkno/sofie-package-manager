import { protectString, LoggerInstance } from '@sofie-package-manager/api'
import { GenericWorker } from '../../worker'

export class PassiveTestWorker extends GenericWorker {
	constructor(logger: LoggerInstance) {
		super(
			logger,
			{
				config: {
					workerId: protectString('test'),
					sourcePackageStabilityThreshold: 0,
					windowsDriveLetters: ['X', 'Y', 'Z'],
				},
				location: {
					// localComputerId?: string
					localNetworkIds: [],
				},
				workerStorageWrite: () => {
					throw new Error('Method not implemented.')
				},
				workerStorageRead: () => {
					throw new Error('Method not implemented.')
				},
			},
			async () => {
				throw new Error('Method not implemented.')
			},
			'passive-test-worker'
		)
	}

	async init() {
		throw new Error('Method not implemented.')
	}
	terminate() {
		throw new Error('Method not implemented.')
	}
	async doYouSupportExpectation(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async getCostFortExpectation(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async isExpectationReadyToStartWorkingOn(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async isExpectationFulfilled(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async workOnExpectation(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async removeExpectation(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async doYouSupportPackageContainer(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async runPackageContainerCronJob(): Promise<any> {
		throw new Error('Method not implemented.')
	}
	async setupPackageContainerMonitors(): Promise<any> {
		throw new Error('Method not implemented.')
	}
}
