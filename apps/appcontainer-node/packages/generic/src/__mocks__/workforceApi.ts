/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { AppContainerId, LoggerInstance, WorkForceAppContainer } from '@sofie-package-manager/api'
import { EventEmitter } from 'events'

export class WorkforceAPI extends EventEmitter implements WorkForceAppContainer.WorkForce {
	constructor(public id: AppContainerId, _loger: LoggerInstance) {
		super()
	}

	connected = false
	public static mockAvailableApps: AppDesc[] = []
	public static mockMethods: Record<string, (...args: any[]) => Promise<void>> = {}

	registerAvailableApps = async (availableApps: AppDesc[]): Promise<void> => {
		WorkforceAPI.mockAvailableApps = availableApps
		return
	}
	init = async (_connectionOptions: any, methods: any) => {
		WorkforceAPI.mockMethods = methods
		this.connected = true
		setImmediate(() => {
			this.emit('connected')
		})
	}

	terminate = () => {
		this.emit('disconnected')
	}
}

type AppDesc = { appType: `@@protectedString/AppType/${string}` }
