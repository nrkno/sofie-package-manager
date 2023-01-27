export function waitTime(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
/**
 * Executes {expectFcn} intermittently until it doesn't throw anymore.
 * Waits up to {maxWaitTime} ms, then throws the latest error.
 * Useful in unit-tests as a way to wait until a predicate is fulfilled.
 */
export async function waitUntil(expectFcn: () => void, maxWaitTime: number): Promise<void> {
	const startTime = Date.now()
	while (true) {
		await waitTime(100)
		try {
			expectFcn()
			return
		} catch (err) {
			let waitedTime = Date.now() - startTime
			if (waitedTime > maxWaitTime) throw err
			// else ignore error and try again later
		}
	}
}
