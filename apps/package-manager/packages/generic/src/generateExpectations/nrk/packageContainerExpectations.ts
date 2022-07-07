import { ActivePlaylist, PackageContainers } from '../../packageManager'
import { PackageContainerExpectation } from '@sofie-package-manager/api'

export function getPackageContainerExpectations(
	managerId: string,
	packageContainers: PackageContainers,
	_activePlaylist: ActivePlaylist
): { [id: string]: PackageContainerExpectation } {
	const o: { [id: string]: PackageContainerExpectation } = {}

	for (const [containerId, packageContainer] of Object.entries(packageContainers)) {
		// This is temporary, to test/show how a monitor would work:
		if (containerId === 'source_monitor') {
			o[containerId] = {
				...packageContainer,
				id: containerId,
				managerId: managerId,
				cronjobs: {},
				monitors: {
					packages: {
						label: 'Monitor Packages on source',
						targetLayers: ['target0'],
						ignore: '.bat',
						// ignore: '',
					},
				},
			}
		}

		// This is a hard-coded hack for the "smartbull" feature,
		// to be replaced or moved out later:
		if (containerId === 'source-smartbull') {
			o[containerId] = {
				...packageContainer,
				id: containerId,
				managerId: managerId,
				cronjobs: {},
				monitors: {
					packages: {
						label: 'Monitor for Smartbull',
						targetLayers: ['source-smartbull'], // not used, since the layers of the original smartbull-package are used
						usePolling: 2000,
						awaitWriteFinishStabilityThreshold: 2000,
					},
				},
			}
		}
	}

	return o
}
