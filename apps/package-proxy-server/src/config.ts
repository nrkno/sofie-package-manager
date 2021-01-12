import yargs = require('yargs/yargs')
import * as _ from 'underscore'

const argv = yargs(process.argv.slice(2)).options({
	port: { type: 'number', default: parseInt(process.env.PROXY_PORT || '', 10) || 8080 },
	apiKeyRead: { type: 'string', default: process.env.PROXY_API_KEY_READ || undefined },
	apiKeyWrite: { type: 'string', default: process.env.PROXY_API_KEY_WRITE || undefined },
	basePath: { type: 'string', default: './fileStorage' },
	logPath: { type: 'string' },
	unsafeSSL: { type: 'boolean', default: process.env.UNSAFE_SSL === '1' },
	certificates: { type: 'string' },
}).argv

// console.log('argv', argv)

if (!argv.apiKeyWrite && argv.apiKeyRead) {
	console.log('Error: When apiKeyRead is given, apiKeyWrite is required!')
	process.exit(1)
}

const certs: string[] = (argv.certificates || process.env.CERTIFICATES || '').split(';') || []

export interface Config {
	process: ProcessConfig
	proxyServer: ProxyServer // todo
}
export interface ProcessConfig {
	logPath: string | undefined
	/** Will cause the Node applocation to blindly accept all certificates. Not recommenced unless in local, controlled networks. */
	unsafeSSL: boolean
	/** Paths to certificates to load, for SSL-connections */
	certificates: string[]
}
export interface ProxyServer {
	port: number

	basePath: string
	apiKeyRead: string | undefined
	apiKeyWrite: string | undefined
}

const config: Config = {
	process: {
		logPath: argv.logPath,
		unsafeSSL: argv.unsafeSSL,
		certificates: _.compact(certs),
	},
	proxyServer: {
		port: argv.port,
		basePath: argv.basePath,
		apiKeyRead: argv.apiKeyRead,
		apiKeyWrite: argv.apiKeyWrite,
	},
}

export { config }
