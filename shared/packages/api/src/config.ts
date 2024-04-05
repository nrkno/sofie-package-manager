import { Options } from 'yargs'
import yargs = require('yargs/yargs')
import _ from 'underscore'
import { WorkerAgentConfig } from './worker'
import { AppContainerConfig } from './appContainer'
import { protectString } from './ProtectedString'
import { AppContainerId, WorkerAgentId } from './ids'

/*
 * This file contains various CLI argument definitions, used by the various processes that together constitutes the Package Manager
 */

/** Generic CLI-argument-definitions for any process */
const processOptions = defineArguments({
	logPath: { type: 'string', describe: 'Set to write logs to this file' },
	logLevel: { type: 'string', describe: 'Set default log level. (Might be overwritten by Sofie Core)' },

	unsafeSSL: {
		type: 'boolean',
		default: process.env.UNSAFE_SSL === '1',
		describe: 'Set to true to allow all SSL certificates (only use this in a safe, local environment)',
	},
	certificates: { type: 'string', describe: 'SSL Certificates' },
})
/** CLI-argument-definitions for the Workforce process */
const workforceArguments = defineArguments({
	port: {
		type: 'number',
		default: parseInt(process.env.WORKFORCE_PORT || '', 10) || 8070,
		describe: 'The port number to start the Workforce websocket server on',
	},
})
/** CLI-argument-definitions for the HTTP-Server process */
const httpServerArguments = defineArguments({
	httpServerPort: {
		type: 'number',
		default: parseInt(process.env.HTTP_SERVER_PORT || '', 10) || 8080,
		describe: 'The port number to use for the HTTP server',
	},
	apiKeyRead: {
		type: 'string',
		default: process.env.HTTP_SERVER_API_KEY_READ || undefined,
		describe: 'Set this to limit read-access',
	},
	apiKeyWrite: {
		type: 'string',
		default: process.env.HTTP_SERVER_API_KEY_WRITE || undefined,
		describe: 'Set this to limit write-access',
	},
	cleanFileAge: {
		type: 'number',
		default: parseInt(process.env.HTTP_SERVER_CLEAN_FILE_AGE || '0', 10) || 3600 * 24 * 30, // default: 30 days
		describe:
			'Automatically remove files older than this age, in seconds (defaults to 30 days). Set to -1 to disable.',
	},
	basePath: {
		type: 'string',
		default: process.env.HTTP_SERVER_BASE_PATH || './fileStorage',
		describe: 'The internal path to use for file storage',
	},
})
/** CLI-argument-definitions for the Package Manager process */
const packageManagerArguments = defineArguments({
	coreHost: {
		type: 'string',
		default: process.env.CORE_HOST || '127.0.0.1',
		describe: 'The IP-address/hostName to Sofie Core',
	},
	corePort: {
		type: 'number',
		default: parseInt(process.env.CORE_PORT || '', 10) || 3000,
		describe: 'The port number of Sofie core (usually 80, 443 or 3000)',
	},

	deviceId: {
		type: 'string',
		default: process.env.DEVICE_ID || '',
		describe: '(Optional) Unique devide id of this device',
	},
	deviceToken: {
		type: 'string',
		default: process.env.DEVICE_TOKEN || '',
		describe: '(Optional) access token of this device.',
	},

	disableWatchdog: {
		type: 'boolean',
		default: process.env.DISABLE_WATCHDOG === '1',
		describe: 'Set to true to disable the Watchdog (it kills the process if connection to Core is lost)',
	},

	port: {
		type: 'number',
		default: parseInt(process.env.PACKAGE_MANAGER_PORT || '', 10) || 8060,
		describe: 'The port number to start the Package Manager websocket server on',
	},
	accessUrl: {
		type: 'string',
		default: process.env.PACKAGE_MANAGER_URL || 'ws://localhost:8060',
		describe: 'The URL where Package Manager websocket server can be accessed',
	},
	workforceURL: {
		type: 'string',
		default: process.env.WORKFORCE_URL || 'ws://localhost:8070',
		describe: 'The URL to the Workforce',
	},
	watchFiles: {
		type: 'boolean',
		default: process.env.WATCH_FILES === '1',
		describe: 'If true, will watch the file "expectedPackages.json" as an additional source of expected packages.',
	},
	noCore: {
		type: 'boolean',
		default: process.env.NO_CORE === '1',
		describe: 'If true, Package Manager wont try to connect to Sofie Core',
	},
	chaosMonkey: {
		type: 'boolean',
		default: process.env.CHAOS_MONKEY === '1',
		describe: 'If true, enables the "chaos monkey"-feature, which will randomly kill processes every few seconds',
	},
	concurrency: {
		type: 'number',
		default: parseInt(process.env.CONCURRENCY || '', 10) || undefined,
		describe: 'How many expectation states can be evaluated at the same time',
	},
})
/** CLI-argument-definitions for the Worker process */
const workerArguments = defineArguments({
	workerId: { type: 'string', default: process.env.WORKER_ID || 'worker0', describe: 'Unique id of the worker' },
	workforceURL: {
		type: 'string',
		default: process.env.WORKFORCE_URL || 'ws://localhost:8070',
		describe: 'The URL to the Workforce',
	},
	appContainerURL: {
		type: 'string',
		default: process.env.APP_CONTAINER_URL || '', // 'ws://localhost:8090',
		describe: 'The URL to the AppContainer',
	},
	windowsDriveLetters: {
		type: 'string',
		default: process.env.WORKER_WINDOWS_DRIVE_LETTERS || 'X;Y;Z',
		describe: 'Which Windows Drive letters can be used to map shares. ("X;Y;Z") ',
	},
	resourceId: {
		type: 'string',
		default: process.env.WORKER_NETWORK_ID || 'default',
		describe: 'Identifier of the local resource/computer this worker runs on',
	},
	networkIds: {
		type: 'string',
		default: process.env.WORKER_NETWORK_ID || 'default',
		describe: 'Identifier of the local networks this worker has access to ("networkA;networkB")',
	},
	costMultiplier: {
		type: 'number',
		default: process.env.WORKER_COST_MULTIPLIER || 1,
		describe: 'Multiply the cost of the worker with this',
	},
	considerCPULoad: {
		type: 'number',
		default: process.env.WORKER_CONSIDER_CPU_LOAD || '',
		describe:
			'If set, the worker will consider the CPU load of the system it runs on before it accepts jobs. Set to a value between 0 and 1, the worker will accept jobs if the CPU load is below the configured value.',
	},
	pickUpCriticalExpectationsOnly: {
		type: 'boolean',
		default: process.env.WORKER_PICK_UP_CRITICAL_EXPECTATIONS_ONLY === '1' || false,
		describe: 'If set to 1, the worker will only pick up expectations that are marked as critical for playout.',
	},
})
/** CLI-argument-definitions for the AppContainer process */
const appContainerArguments = defineArguments({
	appContainerId: {
		type: 'string',
		default: process.env.APP_CONTAINER_ID || 'appContainer0',
		describe: 'Unique id of the appContainer',
	},
	workforceURL: {
		type: 'string',
		default: process.env.WORKFORCE_URL || 'ws://localhost:8070',
		describe: 'The URL to the Workforce',
	},
	port: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_PORT || '', 10) || 8090,
		describe: 'The port number to start the App Container websocket server on',
	},
	maxRunningApps: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_MAX_RUNNING_APPS || '', 10) || 3,
		describe: 'How many apps the appContainer can run at the same time',
	},
	minRunningApps: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_MIN_RUNNING_APPS || '', 10) || 0,
		describe: 'Minimum amount of apps (of a certain appType) to be running',
	},
	maxAppKeepalive: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_MAX_APP_KEEPALIVE || '', 10) || 6 * 3600 * 1000, // ms (6 hours)
		describe: 'Maximum time an app will be kept running',
	},
	spinDownTime: {
		type: 'number',
		default: parseInt(process.env.APP_CONTAINER_SPIN_DOWN_TIME || '', 10) || 60 * 1000, // ms (1 minute)
		describe: 'How long a Worker should stay idle before attempting to be spun down',
	},
	minCriticalWorkerApps: {
		type: 'number',
		default: 0,
		describe: 'Number of Workers reserved for fulfilling playout-critical expectations that will be kept running',
	},

	// These are passed-through to the spun-up workers:
	resourceId: {
		type: 'string',
		default: process.env.WORKER_NETWORK_ID || 'default',
		describe: 'Identifier of the local resource/computer this worker runs on',
	},
	networkIds: {
		type: 'string',
		default: process.env.WORKER_NETWORK_ID || 'default',
		describe: 'Identifier of the local networks this worker has access to ("networkA;networkB")',
	},
	windowsDriveLetters: {
		type: 'string',
		default: process.env.WORKER_WINDOWS_DRIVE_LETTERS || 'X;Y;Z',
		describe: 'Which Windows Drive letters can be used to map shares. ("X;Y;Z") ',
	},
	costMultiplier: {
		type: 'number',
		default: process.env.WORKER_COST_MULTIPLIER || 1,
		describe: 'Multiply the cost of the worker with this',
	},
	considerCPULoad: {
		type: 'number',
		default: process.env.WORKER_CONSIDER_CPU_LOAD || '',
		describe:
			'If set, the worker will consider the CPU load of the system it runs on before it accepts jobs. Set to a value between 0 and 1, the worker will accept jobs if the CPU load is below the configured value.',
	},
})
/** CLI-argument-definitions for the "Single" process */
const singleAppArguments = defineArguments({
	noHTTPServers: {
		type: 'boolean',
		default: process.env.NO_HTTP_SERVERS === '1',
		describe: 'If set, the app will not start the HTTP servers',
	},
	workerCount: {
		type: 'number',
		default: parseInt(process.env.WORKER_COUNT || '', 10) || 1,
		describe: 'How many workers to spin up',
	},
	workforcePort: {
		type: 'number',
		// 0 = Set the workforce port to whatever is available
		default: parseInt(process.env.WORKFORCE_PORT || '', 10) || 0,
		describe: 'The port number to start the Workforce websocket server on',
	},
})
/** CLI-argument-definitions for the Quantel-HTTP-Transformer-Proxy process */
const quantelHTTPTransformerProxyConfigArguments = defineArguments({
	quantelProxyPort: {
		type: 'number',
		default: parseInt(process.env.QUANTEL_HTTP_TRANSFORMER_PROXY_PORT || '', 10) || 8081,
		describe: 'The port on which to server the Quantel-HTTP-Transformer-Proxy server on',
	},
	quantelTransformerURL: {
		type: 'string',
		default: process.env.QUANTEL_HTTP_TRANSFORMER_URL || undefined,
		describe: 'URL to the Quantel-HTTP-Transformer',
	},

	quantelTransformerRateLimitDuration: {
		type: 'number',
		default: parseInt(process.env.QUANTEL_HTTP_TRANSFORMER_RATE_LIMIT_DURATION || '', 10) || undefined,
		describe: 'Rate Limit Duration for the Quantel-HTTP-Transformer [ms]',
	},
	quantelTransformerRateLimitMax: {
		type: 'number',
		default: parseInt(process.env.QUANTEL_HTTP_TRANSFORMER_RATE_LIMIT_MAX || '', 10) || undefined,
		describe: 'Rate Limit Max for the Quantel-HTTP-Transformer',
	},
})

export interface ProcessConfig {
	logPath: string | undefined
	logLevel: string | undefined
	/** Will cause the Node app to blindly accept all certificates. Not recommenced unless in local, controlled networks. */
	unsafeSSL: boolean
	/** Paths to certificates to load, for SSL-connections */
	certificates: string[]
}
function getProcessConfig(argv: {
	logPath: string | undefined
	logLevel: string | undefined
	unsafeSSL: boolean
	certificates: string | undefined
}) {
	const certs: string[] = (argv.certificates || process.env.CERTIFICATES || '').split(';') || []
	return {
		logPath: argv.logPath,
		logLevel: argv.logLevel,
		unsafeSSL: argv.unsafeSSL,
		certificates: _.compact(certs),
	}
}
// Configuration for the Workforce Application: ------------------------------
export interface WorkforceConfig {
	process: ProcessConfig
	workforce: {
		port: number | null
	}
}

export async function getWorkforceConfig(): Promise<WorkforceConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...workforceArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		workforce: {
			port: argv.port,
		},
	}
}
// Configuration for the HTTP server Application: ----------------------------------
export interface HTTPServerConfig {
	process: ProcessConfig
	httpServer: {
		port: number

		basePath: string
		apiKeyRead: string | undefined
		apiKeyWrite: string | undefined
		/** Clean up (remove) files older than this age (in seconds). 0 or -1 means that it's disabled. */
		cleanFileAge: number
	}
}
export async function getHTTPServerConfig(): Promise<HTTPServerConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...httpServerArguments,
			...processOptions,
		}).argv
	)

	if (!argv.apiKeyWrite && argv.apiKeyRead) {
		throw new Error(`Error: When apiKeyRead is given, apiKeyWrite is required!`)
	}

	return {
		process: getProcessConfig(argv),
		httpServer: {
			port: argv.httpServerPort,
			basePath: argv.basePath,
			apiKeyRead: argv.apiKeyRead,
			apiKeyWrite: argv.apiKeyWrite,
			cleanFileAge: argv.cleanFileAge,
		},
	}
}
// Configuration for the Package Manager Application: ------------------------------
export interface PackageManagerConfig {
	process: ProcessConfig
	packageManager: {
		coreHost: string
		corePort: number
		deviceId: string
		deviceToken: string
		disableWatchdog: boolean

		port: number | null
		accessUrl: string | null
		workforceURL: string | null

		watchFiles: boolean
		noCore: boolean
		chaosMonkey: boolean
		concurrency?: number
	}
}
export async function getPackageManagerConfig(): Promise<PackageManagerConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...packageManagerArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		packageManager: {
			coreHost: argv.coreHost,
			corePort: argv.corePort,
			deviceId: argv.deviceId,
			deviceToken: argv.deviceToken,
			disableWatchdog: argv.disableWatchdog,

			port: argv.port,
			accessUrl: argv.accessUrl,
			workforceURL: argv.workforceURL,

			watchFiles: argv.watchFiles,
			noCore: argv.noCore,
			chaosMonkey: argv.chaosMonkey,
			concurrency: argv.concurrency,
		},
	}
}
// Configuration for the Worker Application: ------------------------------
export interface WorkerConfig {
	process: ProcessConfig
	worker: {
		// Note: when changing these values, remember to also update appContainer.ts
		workforceURL: string | null
		appContainerURL: string | null
		resourceId: string
		networkIds: string[]
		costMultiplier: number
		considerCPULoad: number | null
		pickUpCriticalExpectationsOnly: boolean
	} & WorkerAgentConfig
}
export async function getWorkerConfig(): Promise<WorkerConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...workerArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		worker: {
			workerId: protectString<WorkerAgentId>(argv.workerId),
			workforceURL: argv.workforceURL,
			appContainerURL: argv.appContainerURL,

			resourceId: argv.resourceId,
			networkIds: argv.networkIds ? argv.networkIds.split(';') : [],
			windowsDriveLetters: argv.windowsDriveLetters ? argv.windowsDriveLetters.split(';') : [],
			costMultiplier:
				(typeof argv.costMultiplier === 'string' ? parseFloat(argv.costMultiplier) : argv.costMultiplier) || 1,
			considerCPULoad:
				(typeof argv.considerCPULoad === 'string' ? parseFloat(argv.considerCPULoad) : argv.considerCPULoad) ||
				null,
			pickUpCriticalExpectationsOnly: argv.pickUpCriticalExpectationsOnly,
		},
	}
}
// Configuration for the AppContainer Application: ------------------------------
export interface AppContainerProcessConfig {
	process: ProcessConfig
	appContainer: AppContainerConfig
}
export async function getAppContainerConfig(): Promise<AppContainerProcessConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...appContainerArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		appContainer: {
			workforceURL: argv.workforceURL,
			port: argv.port,
			appContainerId: protectString<AppContainerId>(argv.appContainerId),
			maxRunningApps: argv.maxRunningApps,
			minRunningApps: argv.minRunningApps,
			maxAppKeepalive: argv.maxAppKeepalive,
			spinDownTime: argv.spinDownTime,
			minCriticalWorkerApps: argv.minCriticalWorkerApps,

			worker: {
				resourceId: argv.resourceId,
				networkIds: argv.networkIds ? argv.networkIds.split(';') : [],
				windowsDriveLetters: argv.windowsDriveLetters ? argv.windowsDriveLetters.split(';') : [],
				costMultiplier:
					(typeof argv.costMultiplier === 'string' ? parseFloat(argv.costMultiplier) : argv.costMultiplier) ||
					1,
				considerCPULoad:
					(typeof argv.considerCPULoad === 'string'
						? parseFloat(argv.considerCPULoad)
						: argv.considerCPULoad) || null,
			},
		},
	}
}

// Configuration for the Single-app Application: ------------------------------
export interface SingleAppConfig
	extends WorkforceConfig,
		HTTPServerConfig,
		PackageManagerConfig,
		WorkerConfig,
		AppContainerProcessConfig,
		QuantelHTTPTransformerProxyConfig {
	singleApp: {
		noHTTPServers: boolean
		workerCount: number
		workforcePort: number
	}
}

export async function getSingleAppConfig(): Promise<SingleAppConfig> {
	const options = {
		...workforceArguments,
		...httpServerArguments,
		...packageManagerArguments,
		...workerArguments,
		...processOptions,
		...singleAppArguments,
		...appContainerArguments,
		...quantelHTTPTransformerProxyConfigArguments,
	}
	// Remove some that are not used in the Single-App, so that they won't show up when running '--help':

	// @ts-expect-error not optional
	delete options.corePort
	// @ts-expect-error not optional
	delete options.accessUrl
	// @ts-expect-error not optional
	delete options.workforceURL
	// @ts-expect-error not optional
	delete options.port

	const argv = await Promise.resolve(yargs(getProcessArgv()).options(options).argv)

	return {
		process: getProcessConfig(argv),
		workforce: (await getWorkforceConfig()).workforce,
		httpServer: (await getHTTPServerConfig()).httpServer,
		packageManager: (await getPackageManagerConfig()).packageManager,
		worker: (await getWorkerConfig()).worker,
		singleApp: {
			noHTTPServers: argv.noHTTPServers ?? false,
			workerCount: argv.workerCount || 1,
			workforcePort: argv.workforcePort,
		},
		appContainer: (await getAppContainerConfig()).appContainer,
		quantelHTTPTransformerProxy: (await getQuantelHTTPTransformerProxyConfig()).quantelHTTPTransformerProxy,
	}
}
// Configuration for the HTTP server Application: ----------------------------------
export interface QuantelHTTPTransformerProxyConfig {
	process: ProcessConfig
	quantelHTTPTransformerProxy: {
		port: number

		transformerURL?: string

		rateLimitDuration?: number
		rateLimitMax?: number
	}
}
export async function getQuantelHTTPTransformerProxyConfig(): Promise<QuantelHTTPTransformerProxyConfig> {
	const argv = await Promise.resolve(
		yargs(getProcessArgv()).options({
			...quantelHTTPTransformerProxyConfigArguments,
			...processOptions,
		}).argv
	)

	return {
		process: getProcessConfig(argv),
		quantelHTTPTransformerProxy: {
			port: argv.quantelProxyPort,
			transformerURL: argv.quantelTransformerURL,
			rateLimitDuration: argv.quantelTransformerRateLimitDuration,
			rateLimitMax: argv.quantelTransformerRateLimitMax,
		},
	}
}
// ---------------------------------------------------------------------------------

/** Helper function, to get strict typings for the yargs-Options. */
function defineArguments<O extends { [key: string]: Options }>(opts: O): O {
	return opts
}

function getProcessArgv() {
	// Note: process.argv typically looks like this:
	// [
	// 	'C:\\Program Files\\nodejs\\node.exe',
	// 	'C:\\path\\to\\my\\package-manager\\apps\\single-app\\app\\dist\\index.js',
	// 	'--',
	// 	'--watchFiles=true',
	// 	'--noCore=true',
	// 	'--logLevel=debug'
	// ]

	// Remove the first two arguments
	let args = process.argv.slice(2)

	// If the first argument is just '--', remove it:
	if (args[0] === '--') args = args.slice(1)

	return args
}
