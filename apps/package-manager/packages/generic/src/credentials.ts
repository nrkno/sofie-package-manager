import { CoreCredentials, PeripheralDeviceId, protectString } from '@sofie-automation/server-core-integration'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DataStore = require('data-store')

/**
 * @deprecated This is a copy of the old method provided by server-core-integration.
 * 'data-store' is not maintained, so should be replaced with something better soon
 */
export function getCredentials(name: string): CoreCredentials {
	const store = new DataStore(name)

	let credentials: CoreCredentials = store.get('CoreCredentials')
	if (!credentials) {
		credentials = {
			deviceId: protectString<PeripheralDeviceId>(randomString()),
			deviceToken: randomString(),
		}
		store.set('CoreCredentials', credentials)
	}

	return credentials
}

function randomString(length = 20): string {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
	let result = ''
	for (let i = length; i > 0; --i) {
		result += chars[Math.floor(Math.random() * chars.length)]
	}
	return result
}
