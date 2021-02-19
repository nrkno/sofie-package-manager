import { Workforce } from '@shared/workforce'
import { getWorkforceConfig, setupLogging } from '@shared/api'

export async function startProcess(): Promise<void> {
	const config = getWorkforceConfig()

	const logger = setupLogging(config)

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Workforce')
	logger.info('Port: ' + config.workforce.port)
	logger.info('------------------------------------------------------------------')

	const workforce = new Workforce(logger, config)

	workforce.init().catch(logger.error)
}
