import { QuantelHTTPTransformerProxy } from './server'
import { getQuantelHTTPTransformerProxyConfig, setupLogging } from '@shared/api'

export { QuantelHTTPTransformerProxy }
export async function startProcess(): Promise<void> {
	const config = getQuantelHTTPTransformerProxyConfig()

	const logger = setupLogging(config)

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Quantel HTTP Transformer Proxy Server')

	const app = new QuantelHTTPTransformerProxy(logger, config)
	app.init().catch((e) => {
		logger.error(e)
	})
}
