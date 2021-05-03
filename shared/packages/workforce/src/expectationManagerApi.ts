import { WorkForceExpectationManager, AdapterServer, AdapterServerOptions } from '@shared/api'

/**
 * Exposes the API-methods of a ExpectationManager, to be called from the Workforce
 * Note: The ExpectationManager connects to the Workforce, therefore the Workforce is the AdapterServer here.
 * The corresponding other side is implemented at shared/packages/expectationManager/src/workforceApi.ts
 */
export class ExpectationManagerAPI
	extends AdapterServer<WorkForceExpectationManager.WorkForce, WorkForceExpectationManager.ExpectationManager>
	implements WorkForceExpectationManager.ExpectationManager {
	constructor(
		methods: WorkForceExpectationManager.WorkForce,
		options: AdapterServerOptions<WorkForceExpectationManager.ExpectationManager>
	) {
		super(methods, options)
	}

	// Note: This side of the API has no methods exposed.
}
