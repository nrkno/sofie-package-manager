import { startTimer } from '@sofie-package-manager/api'

export function waitTime(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
/**
 * Executes {expectFcn} intermittently until it doesn't throw anymore.
 * Waits up to {maxWaitTime} ms, then throws the latest error.
 * Useful in unit-tests as a way to wait until a predicate is fulfilled.
 */
export async function waitUntil(expectFcn: () => void, maxWaitTime: number): Promise<void> {
	const timer = startTimer()
	const previousErrors: string[] = []

	while (true) {
		await waitTime(100)
		try {
			expectFcn()
			return
		} catch (err) {
			const errorStr = `${err}`
			if (previousErrors.length) {
				const previousError = previousErrors[previousErrors.length - 1]
				if (errorStr !== previousError) {
					previousErrors.push(errorStr)
				}
			} else {
				previousErrors.push(errorStr)
			}

			const waitedTime = timer.get()
			if (waitedTime > maxWaitTime) {
				console.log(`waitUntil: waited for ${waitedTime} ms, giving up (maxWaitTime: ${maxWaitTime}).`)
				console.log(`Previous errors: \n${previousErrors.join('\n')}`)

				throw err
			}
			// else ignore error and try again later
		}
	}
}

export function describeForAllPlatforms(name: string, cbOnce: () => void, cbPerPlatform: (platform: string) => void) {
	describe(name, () => {
		cbOnce()
		let orgProcessPlatform: any
		const platforms = ['win32', 'darwin', 'linux']

		for (const platform of platforms) {
			describe(platform, () => {
				beforeAll(async () => {
					orgProcessPlatform = process.platform
					Object.defineProperty(process, 'platform', {
						value: 'darwin',
					})
				})
				afterAll(() => {
					Object.defineProperty(process, 'platform', {
						value: orgProcessPlatform,
					})
				})
				cbPerPlatform(platform)
			})
		}
	})
}
