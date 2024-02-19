import { CoreCredentials, PeripheralDeviceId, protectString } from '@sofie-automation/server-core-integration'
import { nanoid } from 'nanoid'

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
			deviceId: protectString<PeripheralDeviceId>(nanoid()),
			deviceToken: nanoid(),
		}
		store.set('CoreCredentials', credentials)
	}

	return credentials
}
