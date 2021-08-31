import { getWorkerConfig, ProcessHandler, setupLogging } from '@shared/api'
import { WorkerAgent } from '@shared/worker'

export async function startProcess(): Promise<void> {
	const config = getWorkerConfig()

	const logger = setupLogging(config)

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Worker')
	logger.info('------------------------------------------------------------------')

	const process = new ProcessHandler(logger)
	process.init(config.process)

	const workforce = new WorkerAgent(logger, config)

	workforce.init().catch(logger.error)
}
