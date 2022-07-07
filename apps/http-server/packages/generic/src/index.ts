import { PackageProxyServer } from './server'
import {
	getHTTPServerConfig,
	ProcessHandler,
	setupLogger,
	initializeLogger,
	stringifyError,
} from '@sofie-package-manager/api'

export { PackageProxyServer }
export async function startProcess(): Promise<void> {
	const config = getHTTPServerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info('Starting HTTP Server')

	const process = new ProcessHandler(logger)
	process.init(config.process)

	const app = new PackageProxyServer(logger, config)
	app.init().catch((e) => {
		logger.error(`Error in PackageProxyServer.init: ${stringifyError(e)}`)
	})
}
