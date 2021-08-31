// import * as ChildProcess from 'child_process'
// import * as path from 'path'

import * as HTTPServer from '@http-server/generic'
import * as QuantelHTTPTransformerProxy from '@quantel-http-transformer-proxy/generic'
import * as PackageManager from '@package-manager/generic'
import * as Workforce from '@shared/workforce'
import * as AppConatainerNode from '@appcontainer-node/generic'
import { getSingleAppConfig, ProcessHandler, setupLogging } from '@shared/api'
// import { MessageToAppContainerSpinUp, MessageToAppContainerType } from './__api'

export async function startSingleApp(): Promise<void> {
	const config = getSingleAppConfig()
	const logger = setupLogging(config)
	// Override some of the arguments, as they arent used in the single-app
	config.packageManager.port = 0 // 0 = Set the packageManager port to whatever is available
	config.packageManager.accessUrl = 'ws:127.0.0.1'
	config.packageManager.workforceURL = null // Filled in later
	config.workforce.port = 0 // 0 = Set the workforce port to whatever is available

	const process = new ProcessHandler(logger)
	process.init(config.process)

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Package Manager - Single App')

	logger.info('Core:          ' + config.packageManager.coreHost + ':' + config.packageManager.corePort)
	logger.info('------------------------------------------------------------------')
	// eslint-disable-next-line no-console
	console.log(JSON.stringify(config, undefined, 2))
	logger.info('------------------------------------------------------------------')

	logger.info('Initializing Workforce')
	const workforce = new Workforce.Workforce(logger, config)
	await workforce.init()
	if (!workforce.getPort()) throw new Error(`Internal Error: Got no workforce port`)
	const workforceURL = `ws://127.0.0.1:${workforce.getPort()}`

	config.packageManager.workforceURL = workforceURL
	config.appContainer.workforceURL = workforceURL

	logger.info('Initializing AppContainer')
	const appContainer = new AppConatainerNode.AppContainer(logger, config)
	await appContainer.init()

	logger.info('Initializing Package Manager Connector')
	const connector = new PackageManager.Connector(logger, config, process)
	const expectationManager = connector.getExpectationManager()

	logger.info('Initializing HTTP proxy Server')
	const httpServer = new HTTPServer.PackageProxyServer(logger, config)
	await httpServer.init()

	logger.info('Initializing Quantel HTTP Transform proxy Server')
	const quantelHTTPTransformerProxy = new QuantelHTTPTransformerProxy.QuantelHTTPTransformerProxy(logger, config)
	await quantelHTTPTransformerProxy.init()

	logger.info('Initializing Package Manager (and Expectation Manager)')
	expectationManager.hookToWorkforce(workforce.getExpectationManagerHook())
	await connector.init()

	logger.info('------------------------------------------------------------------')
	logger.info('Initialization complete')
	logger.info('------------------------------------------------------------------')
}
