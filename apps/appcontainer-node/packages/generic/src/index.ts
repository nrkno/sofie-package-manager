import { getAppContainerConfig, ProcessHandler, setupLogger, stringifyError, initializeLogger } from '@sofie-package-manager/api'
import { AppContainer } from './appContainer'

export { AppContainer } from './appContainer'

export async function startProcess(): Promise<void> {
	const config = getAppContainerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

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
		logger.error(`Error in startProcess: ${stringifyError(error)}`)
	}
}
