import { WorkForceExpectationManager, AdapterServer, AdapterServerOptions } from '@shared/api'

/** Handles communications between an ExpectationManager and a Workforce */
export class ExpectationManagerAPI
	extends AdapterServer<WorkForceExpectationManager.WorkForce, WorkForceExpectationManager.ExpectationManager>
	implements WorkForceExpectationManager.ExpectationManager {
	constructor(
		methods: WorkForceExpectationManager.WorkForce,
		options: AdapterServerOptions<WorkForceExpectationManager.ExpectationManager>
	) {
		super(methods, options)
	}
}
