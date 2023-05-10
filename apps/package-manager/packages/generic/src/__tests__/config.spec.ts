import { DEFAULT_LOG_LEVEL } from '@sofie-package-manager/api'
import {
	PACKAGE_MANAGER_DEVICE_CONFIG,
	ConfigSchema,
	DEFAULT_DELAY_REMOVAL_PACKAGE,
	DEFAULT_DELAY_REMOVAL_PACKAGE_INFO,
} from '../configManifest'
import { JSONBlobParse } from '@sofie-automation/server-core-integration'

describe('Config', () => {
	test('default values', () => {
		const deviceConfigSchema = JSONBlobParse(
			PACKAGE_MANAGER_DEVICE_CONFIG.deviceConfigSchema
		) as any as ConfigSchema

		// Ensure that the default values are set correctly
		expect(deviceConfigSchema.properties.logLevel.default).toEqual(DEFAULT_LOG_LEVEL)
		expect(deviceConfigSchema.properties.delayRemoval.default).toEqual(DEFAULT_DELAY_REMOVAL_PACKAGE)
		expect(deviceConfigSchema.properties.delayRemovalPackageInfo.default).toEqual(
			DEFAULT_DELAY_REMOVAL_PACKAGE_INFO
		)
	})
})
export {}
