import { PackageProxyServer } from './server'
import { getHTTPServerConfig, setupLogging } from '@shared/api'

export { PackageProxyServer }
export async function startProcess(): Promise<void> {
	const config = getHTTPServerConfig()

	const logger = setupLogging(config)

	logger.info('------------------------------------------------------------------')
	logger.info('Starting HTTP Server')

	const app = new PackageProxyServer(logger, config)
	app.init().catch((e) => {
		logger.error(e)
	})
}
