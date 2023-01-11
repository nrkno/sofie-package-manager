import _ from 'underscore'
import * as Winston from 'winston'
import { ProcessConfig } from './config'
import { stringifyError } from './lib'

const { combine, label, json, timestamp, printf } = Winston.format

export interface LoggerInstance extends Winston.Logger {
	warning: never // logger.warning is not a function

	category: (category: string, label?: string) => LoggerInstance
}
export type LeveledLogMethod = Winston.LeveledLogMethod

export enum LogLevel {
	ERROR = 'error',
	WARN = 'warn',
	INFO = 'info',
	VERBOSE = 'verbose',
	DEBUG = 'debug',
	SILLY = 'silly',
}

let loggerContainer: Winston.Container | undefined = undefined
let logLevel: LogLevel = LogLevel.SILLY
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
	initialLogLevel?: LogLevel
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
					level: 'verbose',
					handleExceptions: handleProcess, // Handle uncaught Exceptions
					handleRejections: handleProcess, // Handle uncaught Promise Rejections
				}),
				new Winston.transports.File({
					level: 'silly',
					handleExceptions: handleProcess,
					handleRejections: handleProcess,
					filename: logPath,
				}),
			],
		})
		if (initialLogLevel) setLogLevel(initialLogLevel, true)

		logger.info('Logging to', logPath)
	} else {
		const transportConsole = new Winston.transports.Console({
			level: 'silly',
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
		if (initialLogLevel) setLogLevel(initialLogLevel, true)
		logger.info('Logging to Console')
	}
	// Somewhat of a hack, inject the category method:
	const loggerInstance = logger as LoggerInstance
	loggerInstance.category = (subCategory: string, subLabel?: string): LoggerInstance => {
		return setupLogger(
			config,
			`${category ? `${category}.` : ''}${subCategory}`,
			subLabel && `${categoryLabel}>${subLabel}`,
			undefined,
			initialLogLevel
		)
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
