import * as HTTPServer from '@http-server/generic'
import * as QuantelHTTPTransformerProxy from '@quantel-http-transformer-proxy/generic'
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
	logger.info(JSON.stringify(config, undefined, 2))
	logger.info('------------------------------------------------------------------')

	const connector = new PackageManager.Connector(logger, config)
	const expectationManager = connector.getExpectationManager()

	logger.info('Initializing HTTP proxy Server')
	const httpServer = new HTTPServer.PackageProxyServer(logger, config)
	await httpServer.init()

	logger.info('Initializing Quantel HTTP Transform proxy Server')
	const quantelHTTPTransformerProxy = new QuantelHTTPTransformerProxy.QuantelHTTPTransformerProxy(logger, config)
	await quantelHTTPTransformerProxy.init()

	logger.info('Initializing Workforce')
	const workforce = new Workforce.Workforce(logger, config)
	await workforce.init()

	logger.info('Initializing Package Manager (and Expectation Manager)')
	expectationManager.hookToWorkforce(workforce.getExpectationManagerHook())
	await connector.init()

	const workerAgents: any[] = []
	for (let i = 0; i < config.singleApp.workerCount; i++) {
		logger.info('Initializing worker')
		const workerAgent = new Worker.WorkerAgent(logger, {
			...config,
			worker: {
				...config.worker,
				workerId: config.worker.workerId + '_' + i,
			},
		})
		workerAgents.push(workerAgent)

		workerAgent.hookToWorkforce(workforce.getWorkerAgentHook())
		workerAgent.hookToExpectationManager(expectationManager.managerId, expectationManager.getWorkerAgentHook())
		await workerAgent.init()
	}

	logger.info('------------------------------------------------------------------')
	logger.info('Initialization complete')
	logger.info('------------------------------------------------------------------')
})().catch(logger.error)
