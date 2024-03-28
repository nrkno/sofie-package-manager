/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import EventEmitter from 'events'

const packageManagerAPI: any = jest.createMockFromModule('@sofie-package-manager/api')
const realPackageManagerAPI = jest.requireActual('@sofie-package-manager/api')

type ClientType = 'N/A' | 'workerAgent' | 'expectationManager' | 'appContainer'

class MockClientConnection extends EventEmitter {
	constructor() {
		super()
	}

	public clientType: ClientType = 'N/A'
	public clientId = ''
}

export class WebsocketServer extends EventEmitter {
	constructor(public _port: number, public _logger: any, connectionClb: (client: MockClientConnection) => void) {
		super()
		WebsocketServer.connectionClb = connectionClb
	}
	static connectionClb: (connection: MockClientConnection) => void

	static openConnections: MockClientConnection[] = []

	static mockNewConnection(clientId: string, clientType: ClientType): MockClientConnection {
		const newConnection = new MockClientConnection()
		newConnection.clientId = clientId
		newConnection.clientType = clientType
		WebsocketServer.openConnections.push(newConnection)
		WebsocketServer.connectionClb(newConnection)
		return newConnection
	}

	terminate() {
		WebsocketServer.openConnections.forEach((connection) => {
			connection.emit('close')
		})
		this.emit('close')
	}
}
packageManagerAPI.WebsocketServer = WebsocketServer

// these are various utilities, not really a part of the API
packageManagerAPI.initializeLogger = realPackageManagerAPI.initializeLogger
packageManagerAPI.setupLogger = realPackageManagerAPI.setupLogger
packageManagerAPI.protectString = realPackageManagerAPI.protectString
packageManagerAPI.unprotectString = realPackageManagerAPI.unprotectString
packageManagerAPI.literal = realPackageManagerAPI.literal
packageManagerAPI.mapEntries = realPackageManagerAPI.mapEntries
packageManagerAPI.findValue = realPackageManagerAPI.findValue
packageManagerAPI.DataStore = realPackageManagerAPI.DataStore
packageManagerAPI.stringifyError = realPackageManagerAPI.stringifyError
packageManagerAPI.waitTime = realPackageManagerAPI.waitTime

module.exports = packageManagerAPI
