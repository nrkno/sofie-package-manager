import { DeviceConfigManifest, ConfigManifestEntryType } from '@sofie-automation/server-core-integration'
import { LogLevel } from '@sofie-package-manager/api'

export const DEFAULT_DELAY_REMOVAL_PACKAGE = 21600000
export const DEFAULT_DELAY_REMOVAL_PACKAGE_INFO = 21600000

export const PACKAGE_MANAGER_DEVICE_CONFIG: DeviceConfigManifest = {
	deviceConfig: [
		{
			id: 'logLevel',
			name: 'Log level',
			type: ConfigManifestEntryType.ENUM,
			values: LogLevel,
			defaultVal: 'info',
		},
		{
			id: 'delayRemoval',
			name: 'Delay removal of packages (milliseconds)',
			type: ConfigManifestEntryType.INT,
			defaultVal: DEFAULT_DELAY_REMOVAL_PACKAGE,
		},
		{
			id: 'delayRemovalPackageInfo',
			name: 'Delay removal of package scan results (milliseconds)',
			type: ConfigManifestEntryType.INT,
			defaultVal: DEFAULT_DELAY_REMOVAL_PACKAGE_INFO,
		},
		{
			id: 'useTemporaryFilePath',
			name: 'Use temporary file paths when copying',
			type: ConfigManifestEntryType.BOOLEAN,
		},
	],
}
