import _ from 'underscore'
import * as Winston from 'winston'
import { ProcessConfig } from './config'
import { stringifyError } from './lib'

export interface LoggerInstance extends Winston.Logger {
	warning: never // logger.warning is not a function

	getLogLevel: () => LogLevel
	setLogLevel: (level: LogLevel, startup?: boolean) => void
}
export type LeveledLogMethod = Winston.LeveledLogMethod

/** Sets up logging for a process. Intended to be run when a new process is started. */
export function setupLogging(config: { process: ProcessConfig }): LoggerInstance {
	// Setup logging --------------------------------------
	const logPath = config.process.logPath
	const isProduction = !process.execPath.match(/node.exe$/)

	let logger: LoggerInstance
	let transports: {
		console?: Winston.transports.ConsoleTransportInstance
		file?: Winston.transports.FileTransportInstance
	}
	function getLogLevel(): LogLevel {
		return logger.level as LogLevel
	}
	function setLogLevel(level: LogLevel, startup = false) {
		if (logger.level !== level || startup) {
			logger.level = level
			if (transports.console) {
				transports.console.level = level
			}
			if (transports.file) {
				transports.file.level = level
			}
		}
	}

	if (logPath) {
		// Log to file, as well as to console:
		const transportConsole = new Winston.transports.Console({
			level: 'verbose',
			handleExceptions: true,
			handleRejections: true,
		})
		const transportFile = new Winston.transports.File({
			level: 'silly',
			handleExceptions: true,
			handleRejections: true,
			filename: logPath,
		})

		transports = {
			console: transportConsole,
			file: transportFile,
		}
		// @ts-expect-error hack
		logger = Winston.createLogger({
			format: Winston.format.json(),
			transports: [transportConsole, transportFile],
		})
		logger.getLogLevel = getLogLevel
		logger.setLogLevel = setLogLevel

		logger.info('Logging to', logPath)
	} else {
		const transportConsole = new Winston.transports.Console({
			level: 'silly',
			handleExceptions: true,
			handleRejections: true,
		})
		transports = {
			console: transportConsole,
		}

		if (isProduction) {
			// @ts-expect-error hack
			logger = Winston.createLogger({
				format: Winston.format.json(),
				transports: [transportConsole],
			})
		} else {
			const customFormat = Winston.format.printf((o) => {
				const meta = _.omit(o, 'level', 'message', 'timestamp')
				return `[${o.level}] ${safeStringify(o.message)} ${!_.isEmpty(meta) ? safeStringify(meta) : ''}`
			})
			// @ts-expect-error hack
			logger = Winston.createLogger({
				format: Winston.format.combine(Winston.format.timestamp(), customFormat),
				transports: [transportConsole],
			})
		}
		logger.getLogLevel = getLogLevel
		logger.setLogLevel = setLogLevel

		logger.info('Logging to Console')
	}

	// Because the default NodeJS-handler sucks and wont display error properly
	process.on('unhandledRejection', (reason: any, p: any) => {
		logger.error(`Unhandled Promise rejection, reason: ${reason}, promise: ${p}`)
	})
	process.on('warning', (e: any) => {
		logger.error(`Unhandled warning: ${stringifyError(e)}`)
	})
	return logger
}
export enum LogLevel {
	ERROR = 'error',
	WARN = 'warn',
	INFO = 'info',
	VERBOSE = 'verbose',
	DEBUG = 'debug',
	SILLY = 'silly',
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
