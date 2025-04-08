import { Workforce } from '@sofie-package-manager/workforce'
import { getWorkforceConfig, setupLogger, initializeLogger, stringifyError } from '@sofie-package-manager/api'

export async function startProcess(): Promise<void> {
	const config = await getWorkforceConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Workforce')
	logger.info('Port: ' + config.workforce.port)
	logger.info('------------------------------------------------------------------')

	const workforce = new Workforce(logger, config)

	workforce.init().catch((e) => logger.error(stringifyError(e)))
}
