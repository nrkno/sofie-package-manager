import { Connector, Config } from './connector'
import {
	getPackageManagerConfig,
	LoggerInstance,
	ProcessHandler,
	setupLogger,
	initializeLogger,
	stringifyError,
} from '@sofie-package-manager/api'

export { Connector, Config }
export async function startProcess(
	startInInternalMode?: boolean
): Promise<{ logger: LoggerInstance; connector: Connector }> {
	const config = await getPackageManagerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Package Manager')
	if (config.packageManager.disableWatchdog) logger.info('Watchdog is disabled!')
	if (startInInternalMode) {
		config.packageManager.port = null
		config.packageManager.accessUrl = null
		config.packageManager.workforceURL = null
	}

	const process = new ProcessHandler(logger)
	process.init(config.process)

	const connector = new Connector(logger, config, process)

	logger.info('Core:          ' + config.packageManager.coreHost + ':' + config.packageManager.corePort)
	logger.info('------------------------------------------------------------------')

	if (!startInInternalMode) {
		connector.init().catch((e) => {
			logger.error(`Error in connector.init: ${stringifyError(e)}`)
		})
	}
	return { logger, connector }
}
