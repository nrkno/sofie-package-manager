import { PackageContainers } from '../../packageManager'
import {
	PackageContainerExpectation,
	ExpectationManagerId,
	PackageContainerId,
	objectEntries,
} from '@sofie-package-manager/api'
import { SMARTBULL_STORAGE_ID, SOURCE_MONITOR_STORAGE_ID, TEMPORARY_STORAGE_ID } from './lib'
// eslint-disable-next-line node/no-extraneous-import
import { PackageManagerActivePlaylist } from '@sofie-automation/shared-lib/dist/package-manager/publications'

// Max age for untracked files
const MAX_FILE_AGE = 30 * 24 * 3600 // 30 days

export function getPackageContainerExpectations(
	managerId: ExpectationManagerId,
	packageContainers: PackageContainers,
	_activePlaylist: PackageManagerActivePlaylist | null
): Record<PackageContainerId, PackageContainerExpectation> {
	const o: Record<PackageContainerId, PackageContainerExpectation> = {}

	for (const [containerId, packageContainer] of objectEntries(packageContainers)) {
		// This is temporary, to test/show how a monitor would work:
		if (containerId === SOURCE_MONITOR_STORAGE_ID) {
			o[containerId] = {
				...packageContainer,
				id: containerId,
				managerId: managerId,
				cronjobs: {},
				monitors: {
					packages: {
						label: 'Monitor Packages on source',
						targetLayers: ['target0'],
						ignore: ['.bat'],
						// ignore: '',
					},
				},
			}
		}

		// This is a hard-coded hack for the "smartbull" feature,
		// to be replaced or moved out later:
		if (containerId === SMARTBULL_STORAGE_ID) {
			o[containerId] = {
				...packageContainer,
				id: containerId,
				managerId: managerId,
				cronjobs: {},
				monitors: {
					packages: {
						label: 'Monitor for Smartbull',
						targetLayers: ['source-smartbull'], // not used, since the layers of the original smartbull-package are used
					},
				},
			}
		}
		// There is a risk that the temporary storage gets a few old files left behind.
		// Therefore we specifically set the cronjob to remove those:
		if (containerId === TEMPORARY_STORAGE_ID) {
			o[containerId] = {
				...packageContainer,
				id: containerId,
				managerId: managerId,
				cronjobs: {
					cleanup: {
						label: 'Clean up old packages and old files',
						cleanFileAge: MAX_FILE_AGE,
					},
				},
				monitors: {},
			}
		}
	}

	return o
}
