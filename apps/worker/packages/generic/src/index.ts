import { getWorkerConfig, ProcessHandler, setupLogging } from '@shared/api'
import { WorkerAgent } from '@shared/worker'

export async function startProcess(): Promise<void> {
	const config = getWorkerConfig()

	const logger = setupLogging(config)

	logger.info('------------------------------------------------------------------')
	logger.info(`Starting Worker: PID=${process.pid}`)
	logger.info('------------------------------------------------------------------')

	const processHandler = new ProcessHandler(logger)
	processHandler.init(config.process)

	const workforce = new WorkerAgent(logger, config)

	process.on('exit', (code) => {
		logger.info(`Worker: Closing with exitCode: ${code}`)
		workforce.terminate()
	})

	workforce.init().catch(logger.error)
}
