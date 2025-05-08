import _ from 'underscore'
import * as Winston from 'winston'
import { ProcessConfig } from './config'
import { isRunningInTest, literal, stringifyError } from './lib'

const { combine, label, json, timestamp, printf } = Winston.format

export interface LoggerInstanceFull extends Winston.Logger {
	warning: never // logger.warning is not a function

	category: (category: string) => LoggerInstance
}
/** Like LoggerInstance, but is optimized for memory usage (reducing memory leaks) */
export interface LoggerInstance {
	error: LeveledLogMethodLight
	warn: LeveledLogMethodLight
	info: LeveledLogMethodLight
	debug: LeveledLogMethodLight
	verbose: LeveledLogMethodLight
	silly: LeveledLogMethodLight

	category: (category: string) => LoggerInstance
}
/** This is a subset of Winston.LeveledLogMethod */
export type LeveledLogMethodLight = (msg: any, data?: any) => void
export type LeveledLogMethod = Winston.LeveledLogMethod

export enum LogLevel {
	ERROR = 'error',
	WARN = 'warn',
	INFO = 'info',
	VERBOSE = 'verbose',
	DEBUG = 'debug',
	SILLY = 'silly',
}
export function isLogLevel(logLevel: string): logLevel is LogLevel {
	return ['error', 'warn', 'info', 'verbose', 'debug', 'silly'].includes(logLevel)
}

export const DEFAULT_LOG_LEVEL = LogLevel.VERBOSE

let loggerContainer: Winston.Container | undefined = undefined
let logLevel: LogLevel = DEFAULT_LOG_LEVEL
const allLoggers = new Map<string, LoggerInstance>()
/** Sets up logging for a process. Intended to be run once when a new process is started. */
export function initializeLogger(config: { process: ProcessConfig }): void {
	if (loggerContainer) throw new Error('Logging is already setup!')

	loggerContainer = new Winston.Container()

	const processLogger = setupLogger(config, 'process', 'Process', true)
	// Because the default NodeJS-handler sucks and wont display error properly
	process.on('unhandledRejection', (reason: any, p: any) => {
		processLogger.error(`Unhandled Promise rejection, reason: ${stringifyError(reason)}, promise: ${p}`)
	})
	process.on('warning', (e: any) => {
		processLogger.error(`Unhandled warning: ${stringifyError(e)}`)
	})

	const initialLogLevel = config.process.logLevel
	if (initialLogLevel && isLogLevel(initialLogLevel)) {
		processLogger.info(`Setting log level to ${logLevel}`)
		setLogLevel(initialLogLevel)
	}
}
export function getLogLevel(): LogLevel {
	if (!loggerContainer) throw new Error('Logging has not been set up! initializeLogger() must be called first.')
	return logLevel
}
export function setLogLevel(level: LogLevel, startup = false): void {
	if (!loggerContainer) throw new Error('Logging has not been set up! initializeLogger() must be called first.')
	if (logLevel !== level || startup) {
		logLevel = level
		for (const [_category, logger] of loggerContainer.loggers) {
			for (const transport of logger.transports) {
				transport.level = logLevel
			}
		}
	}
}
export function setupLogger(
	config: { process: ProcessConfig },
	category: string,
	categoryLabel?: string,
	handleProcess = false,
	initialLogLevel?: LogLevel,
	filterFcn?: (level: string, ...args: any[]) => boolean
): LoggerInstance {
	if (!loggerContainer) throw new Error('Logging has not been set up! initializeLogger() must be called first.')

	if (!categoryLabel) categoryLabel = category

	const existing = allLoggers.get(category)
	if (existing) return existing

	// Setup logging --------------------------------------
	const logPath = config.process.logPath
	const isProduction = !process.execPath.match(/node.exe$/)

	let logger: Winston.Logger

	if (logPath) {
		// Log to file, as well as to console:

		logger = loggerContainer.add(category, {
			format: combine(label({ label: categoryLabel }), json()),
			transports: [
				new Winston.transports.Console({
					level: LogLevel.VERBOSE,
					handleExceptions: handleProcess, // Handle uncaught Exceptions
					handleRejections: handleProcess, // Handle uncaught Promise Rejections
				}),
				new Winston.transports.File({
					level: LogLevel.SILLY,
					handleExceptions: handleProcess,
					handleRejections: handleProcess,
					filename: logPath,
				}),
			],
		})
		if (initialLogLevel) setLogLevel(initialLogLevel, true)

		if (handleProcess) {
			logger.info(`Logging to "${logPath}"`)
		}
	} else {
		const transportConsole = new Winston.transports.Console({
			level: logLevel,
			handleExceptions: handleProcess,
			handleRejections: handleProcess,
		})

		if (isProduction) {
			logger = loggerContainer.add(category, {
				format: combine(timestamp(), label({ label: categoryLabel }), json()),
				transports: [transportConsole],
			})
		} else {
			const customFormat = printf((o) => {
				let str = `[${o.level}]`
				const meta = _.omit(o, 'level', 'message', 'timestamp')
				if (meta.label) {
					str += ` [${meta.label}]`
					delete meta.label
				}
				str += ` ${safeStringify(o.message)}`
				if (!_.isEmpty(meta)) {
					str += `  ${safeStringify(meta)}`
				}
				return str
			})

			logger = loggerContainer.add(category, {
				format: combine(timestamp(), label({ label: categoryLabel }), customFormat),
				transports: [transportConsole],
			})
		}
		if (handleProcess && !isRunningInTest()) {
			// Is not running in Jest
			logger.info('Logging to Console')
		}
		if (initialLogLevel) setLogLevel(initialLogLevel, true)
	}
	// Somewhat of a hack, inject the category method:
	const loggerInstance = logger as any as LoggerInstance

	loggerInstance.category = getCategory(loggerInstance, '')

	if (filterFcn) {
		for (const methodName of [
			'error',
			'warn',
			'help',
			'data',
			'info',
			'debug',
			'prompt',
			'http',
			'verbose',
			'input',
			'silly',
		]) {
			const orgMethod = (loggerInstance as any)[methodName]
			;(loggerInstance as any)[methodName] = (...args: any[]) => {
				if (filterFcn(methodName, ...args)) orgMethod.call(loggerInstance, ...args)
			}
		}
	}

	allLoggers.set(category, loggerInstance)
	return loggerInstance
}

function safeStringify(o: any): string {
	if (typeof o === 'string') return o
	if (typeof o === 'number') return o + ''
	if (typeof o === 'boolean') return o + ''

	try {
		return JSON.stringify(o) // make single line
	} catch (e) {
		return 'ERROR in safeStringify: ' + stringifyError(e)
	}
}
function getCategory(outerLogger: LoggerInstance, outerCategory: string) {
	return (subCategory: string): LoggerInstance => {
		// Notes:
		// This returns a lightweight logger method, similar to the Winston.logger
		// The reason for implementing this lightweight logger is to avoid memory leaks
		// Which can happen when using Winston.logger directly
		// (when using logger.category('subCategory') intermittently)

		const fullCategory = `${outerCategory ? `${outerCategory}.` : ''}${subCategory}`

		const createLogMethod = (type: keyof LoggerInstance) => {
			return (msg: any, data?: any) => {
				let msgStr = `${fullCategory}: ${safeStringify(msg)}`

				if (data !== undefined) msgStr += ` ${safeStringify(data)}`

				outerLogger[type](msgStr)
			}
		}

		return literal<LoggerInstance>({
			error: createLogMethod('error'),
			warn: createLogMethod('warn'),
			info: createLogMethod('info'),
			debug: createLogMethod('debug'),
			verbose: createLogMethod('verbose'),
			silly: createLogMethod('silly'),
			category: getCategory(outerLogger, fullCategory),
		})
	}
}
