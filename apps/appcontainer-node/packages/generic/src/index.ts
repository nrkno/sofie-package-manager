import { getAppContainerConfig, ProcessHandler, setupLogging } from '@shared/api'
import { AppContainer } from './appContainer'

export { AppContainer } from './appContainer'

export async function startProcess(): Promise<void> {
	const config = getAppContainerConfig()

	const logger = setupLogging(config)

	try {
		logger.info('------------------------------------------------------------------')
		logger.info('Starting AppContainer')
		logger.info('------------------------------------------------------------------')

		const process = new ProcessHandler(logger)
		process.init(config.process)

		const appContainer = new AppContainer(logger, config)

		await appContainer.init()

		logger.info('------------------------------------------------------------------')
		logger.info('Initialized!')
		logger.info('------------------------------------------------------------------')
	} catch (error) {
		logger.error(error as any)
	}
}
