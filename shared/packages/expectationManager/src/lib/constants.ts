export interface ExpectationManagerConstants {
	/** Time between iterations of the expectation queue [ms] */
	EVALUATE_INTERVAL: number
	/** Minimum time between re-evaluating fulfilled expectations [ms] */
	FULLFILLED_MONITOR_TIME: number
	/**
	 * If the iteration of the queue has been going for this time
	 * allow skipping the rest of the queue in order to reiterate the high-prio expectations [ms]
	 */
	ALLOW_SKIPPING_QUEUE_TIME: number

	/** If there has been no updated on a work-in-progress, time it out after this time */
	WORK_TIMEOUT_TIME: number

	/** How long to wait before requesting more resources (workers) [ms] */
	SCALE_UP_TIME: number
	/** How many resources to request at a time */
	SCALE_UP_COUNT: number

	/** How often to re-query a worker if it supports an expectation [ms] */
	WORKER_SUPPORT_TIME: number

	/** How long to wait in case of an expectation error before trying again [ms] */
	ERROR_WAIT_TIME: number

	/** How many times to try to remove a package upon fail */
	FAILED_REMOVE_COUNT: number

	/** Default interval for running cronjobs */
	DEFAULT_CRONJOB_INTERVAL: number

	/** How many Expectation to evaluate in parallel */
	PARALLEL_CONCURRENCY: number
}

export function getDefaultConstants(): ExpectationManagerConstants {
	return {
		// Default values:
		EVALUATE_INTERVAL: 5 * 1000,
		FULLFILLED_MONITOR_TIME: 30 * 1000,
		WORK_TIMEOUT_TIME: 30 * 1000,
		ALLOW_SKIPPING_QUEUE_TIME: 30 * 1000,
		SCALE_UP_TIME: 5 * 1000,
		SCALE_UP_COUNT: 1,
		WORKER_SUPPORT_TIME: 60 * 1000,
		ERROR_WAIT_TIME: 30 * 1000,

		FAILED_REMOVE_COUNT: 2,
		DEFAULT_CRONJOB_INTERVAL: 60 * 1000,

		PARALLEL_CONCURRENCY: 50,
	}
}
