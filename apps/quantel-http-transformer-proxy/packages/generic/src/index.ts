import { QuantelHTTPTransformerProxy } from './server'
import {
	getQuantelHTTPTransformerProxyConfig,
	ProcessHandler,
	initializeLogger,
	stringifyError,
	setupLogger,
} from '@sofie-package-manager/api'

export { QuantelHTTPTransformerProxy }
export async function startProcess(): Promise<void> {
	const config = getQuantelHTTPTransformerProxyConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Quantel HTTP Transformer Proxy Server')

	const process = new ProcessHandler(logger)
	process.init(config.process)

	const app = new QuantelHTTPTransformerProxy(logger, config)
	app.init().catch((e) => {
		logger.error(`Error in QuantelHTTPTransformerProxy.init: ${stringifyError(e)}`)
	})
}
