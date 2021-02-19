import * as HTTPServer from '@http-server/generic'
import * as PackageManager from '@package-manager/generic'
import * as Workforce from '@shared/workforce'
import * as Worker from '@shared/worker'
import { getSingleAppConfig, setupLogging } from '@shared/api'

console.log('process started') // This is a message all Sofie processes log upon startup

const config = getSingleAppConfig()
const logger = setupLogging(config)

;(async function start() {
	// Override some of the arguments, as they arent used in the single-app
	config.packageManager.port = null
	config.packageManager.accessUrl = null
	config.packageManager.workforceURL = null
	config.workforce.port = null
	config.worker.workforceURL = null

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Package Manager - Single App')

	logger.info('Core:          ' + config.packageManager.coreHost + ':' + config.packageManager.corePort)
	logger.info('------------------------------------------------------------------')

	const connector = new PackageManager.Connector(logger, config)
	const expectationManager = connector.getExpectationManager()

	logger.info('Initializing HTTP proxy Server')
	const httpServer = new HTTPServer.PackageProxyServer(logger, config)
	await httpServer.init()

	logger.info('Initializing Workforce')
	const workforce = new Workforce.Workforce(logger, config)
	await workforce.init()

	logger.info('Initializing Package Manager (and Expectation Manager)')
	expectationManager.hookToWorkforce(workforce.getExpectationManagerHook())
	await connector.init()

	logger.info('Initializing worker')
	const workerAgent = new Worker.WorkerAgent(logger, config)
	workerAgent.hookToWorkforce(workforce.getWorkerAgentHook())
	workerAgent.hookToExpectationManager(expectationManager.managerId, expectationManager.getWorkerAgentHook())
	await workerAgent.init()

	logger.info('------------------------------------------------------------------')
	logger.info('Initialization complete')
	logger.info('------------------------------------------------------------------')
})().catch(logger.error)
