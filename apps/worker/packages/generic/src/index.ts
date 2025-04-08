import {
	getWorkerConfig,
	ProcessHandler,
	setupLogger,
	initializeLogger,
	stringifyError,
} from '@sofie-package-manager/api'
import { WorkerAgent } from '@sofie-package-manager/worker'

export async function startProcess(): Promise<void> {
	const config = await getWorkerConfig()

	initializeLogger(config)
	const logger = setupLogger(config, '')

	logger.info('------------------------------------------------------------------')
	logger.info(`Starting Worker: PID=${process.pid}`)
	logger.info('------------------------------------------------------------------')

	const processHandler = new ProcessHandler(logger)
	processHandler.init(config.process)

	const workerAgent = new WorkerAgent(logger, config)

	process.on('exit', (code) => {
		logger.info(`Worker: Closing with exitCode: ${code}`)
		workerAgent.terminate()
	})

	workerAgent.init().catch((e) => {
		logger.error(`Worker: Error in init: ${stringifyError(e)}`)
	})
}
