import { DeviceConfigManifest, ConfigManifestEntryType } from '@sofie-automation/server-core-integration'
import { LogLevel } from '@sofie-package-manager/api'

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
		},
		{
			id: 'delayRemovalPackageInfo',
			name: 'Delay removal of package scan results (milliseconds)',
			type: ConfigManifestEntryType.INT,
		},
		{
			id: 'useTemporaryFilePath',
			name: 'Use temporary file paths when copying',
			type: ConfigManifestEntryType.BOOLEAN,
		},
	],
}
