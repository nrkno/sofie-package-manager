import { DeviceConfigManifest, JSONBlobStringify, JSONSchema } from '@sofie-automation/server-core-integration'

import ConfigSchemaJSON = require('./$schemas/options.json')

export const PACKAGE_MANAGER_DEVICE_CONFIG: DeviceConfigManifest = {
	deviceConfigSchema: JSONBlobStringify<JSONSchema>(ConfigSchemaJSON as any),
	subdeviceManifest: {},
}

export type ConfigSchema = typeof ConfigSchemaJSON
export const DEFAULT_DELAY_REMOVAL_PACKAGE = ConfigSchemaJSON.properties.delayRemoval.default
export const DEFAULT_DELAY_REMOVAL_PACKAGE_INFO = ConfigSchemaJSON.properties.delayRemovalPackageInfo.default
