import * as HTTPServer from '@http-server/generic'
import * as QuantelHTTPTransformerProxy from '@quantel-http-transformer-proxy/generic'
import * as PackageManager from '@package-manager/generic'
import * as Workforce from '@sofie-package-manager/workforce'
import * as AppConatainerNode from '@appcontainer-node/generic'
import { getSingleAppConfig, ProcessHandler, setupLogger, initializeLogger } from '@sofie-package-manager/api'

export async function startSingleApp(): Promise<void> {
	const config = await getSingleAppConfig()
	initializeLogger(config)
	const logger = setupLogger(config, 'single-app')
	const baseLogger = setupLogger(config, '')
	// Override some of the arguments, as they arent used in the single-app
	config.packageManager.port = 0 // 0 = Set the packageManager port to whatever is available
	config.packageManager.accessUrl = 'ws:127.0.0.1'
	config.packageManager.workforceURL = null // Filled in later

	// Override some of the other arguments, and use the single-app specific ones instead:
	config.workforce.port = config.singleApp.workforcePort

	const process = new ProcessHandler(baseLogger)
	process.init(config.process)

	logger.info('------------------------------------------------------------------')
	logger.info('Starting Package Manager - Single App')

	if (!config.packageManager.noCore) {
		logger.info('Core:          ' + config.packageManager.coreHost + ':' + config.packageManager.corePort)
	}
	logger.info('------------------------------------------------------------------')
	// eslint-disable-next-line no-console
	console.log(JSON.stringify(config, undefined, 2))
	logger.info('------------------------------------------------------------------')

	logger.info('Initializing Workforce')
	const workforce = new Workforce.Workforce(baseLogger, config)
	await workforce.init()
	if (!workforce.getPort()) throw new Error(`Internal Error: Got no workforce port`)
	const workforceURL = `ws://127.0.0.1:${workforce.getPort()}`

	logger.info(`Workforce started on ${workforceURL}`)

	config.packageManager.workforceURL = workforceURL
	config.appContainer.workforceURL = workforceURL

	logger.info('Initializing AppContainer')
	const appContainer = new AppConatainerNode.AppContainer(baseLogger, config)
	await appContainer.init()

	logger.info('Initializing Package Manager Connector')
	const connector = new PackageManager.Connector(baseLogger, config, process)
	const expectationManager = connector.getExpectationManager()

	if (!config.singleApp.noHTTPServers) {
		logger.info('Initializing HTTP proxy Server')
		const httpServer = new HTTPServer.PackageProxyServer(baseLogger, config)
		await httpServer.init()

		logger.info('Initializing Quantel HTTP Transform proxy Server')
		const quantelHTTPTransformerProxy = new QuantelHTTPTransformerProxy.QuantelHTTPTransformerProxy(
			baseLogger,
			config
		)
		await quantelHTTPTransformerProxy.init()
	}

	connector.checkIfWorking()

	logger.info('Initializing Package Manager (and Expectation Manager)') // If this log line is changed, make sure that verify-build-win32.mjs is updated too.
	expectationManager.hookToWorkforce(workforce.getExpectationManagerHook())
	await connector.init()

	logger.info('------------------------------------------------------------------')
	logger.info('Initialization complete')
	logger.info('------------------------------------------------------------------')
}
