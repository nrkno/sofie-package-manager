import { createSocket as createUdpSocket } from 'dgram'
import { createServer } from 'net'
import { PackageProxyServer } from './server'
import { exec } from 'child_process'
import { LoggerInstance } from '@sofie-package-manager/api'

const LOG_INTERVAL = 60 * 1000
const UDP_PORT = 8772
const TCP_PORT = 8774

async function getHostSocketCount() {
	return new Promise<string>((r) => {
		exec('ss | wc -l', (e, stdout) => {
			if (e) {
				r('Failed')
			} else {
				r(stdout)
			}
		})
	})
}

export function initDebug(app: PackageProxyServer, logger: LoggerInstance): void {
	// wrap asynchronous callbacks into a synchronous function so we can catch and log errors
	const asyncCb =
		<T extends any[]>(cb: (...args: T) => Promise<any>) =>
		(...args: T) => {
			cb(...args).catch((e) => logger.error(e))
		}

	const udpSocket = createUdpSocket(
		'udp4',
		asyncCb(async (msg, rinfo) => {
			const m = msg.toString()
			if (m === 'ping') {
				udpSocket.send('pong\r\n', rinfo.port, rinfo.address)
			} else if (m === 'info') {
				udpSocket.send(
					JSON.stringify({ ...(await app.getDebugDump()), hostSocketCount: await getHostSocketCount() })
				)
			}
		})
	)
	udpSocket.bind(UDP_PORT)

	const tcpSocket = createServer((s) => {
		s.on(
			'data',
			asyncCb(async (data) => {
				const m = data.toString()
				if (m === 'ping') {
					s.write('pong\r\n')
				} else if (m === 'info') {
					s.write(
						JSON.stringify({ ...(await app.getDebugDump()), hostSocketCount: await getHostSocketCount() })
					)
				}
			})
		)
	})
	tcpSocket.listen(TCP_PORT)

	setInterval(
		asyncCb(async () => {
			logger.debug('PM HTTP Server alive', {
				...(await app.getDebugDump()),
				hostSocketCount: await getHostSocketCount(),
			})
		}),
		LOG_INTERVAL
	)
}
