import { QuantelHTTPTransformerProxy } from './server'
import { getQuantelHTTPTransformerProxyConfig, ProcessHandler, setupLogging } from '@shared/api'

export { QuantelHTTPTransformerProxy }
export async function startProcess(): Promise<void> {
	const config = getQuantelHTTPTransformerProxyConfig()

	const logger = setupLogging(config)

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Quantel HTTP Transformer Proxy Server')

	const process = new ProcessHandler(logger)
	process.init(config.process)

	const app = new QuantelHTTPTransformerProxy(logger, config)
	app.init().catch((e) => {
		logger.error(e)
	})
}
