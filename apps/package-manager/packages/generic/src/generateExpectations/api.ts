import { ExpectedPackageWrap, PackageContainers } from '../packageManager'
import { PackageManagerSettings } from '../generated/options'
import { Expectation, LoggerInstance, PackageContainerExpectation } from '@sofie-package-manager/api'
import {
	PackageManagerActivePlaylist,
	PackageManagerActiveRundown,
	// eslint-disable-next-line node/no-extraneous-import
} from '@sofie-automation/shared-lib/dist/package-manager/publications'

export interface GenerateExpectationApi {
	getExpectations: (
		logger: LoggerInstance,
		managerId: string,
		packageContainers: PackageContainers,
		_activePlaylist: PackageManagerActivePlaylist | null,
		activeRundowns: PackageManagerActiveRundown[],
		expectedPackages: ExpectedPackageWrap[],
		settings: PackageManagerSettings
	) => { [id: string]: Expectation.Any }

	getPackageContainerExpectations: (
		managerId: string,
		packageContainers: PackageContainers,
		_activePlaylist: PackageManagerActivePlaylist | null
	) => { [id: string]: PackageContainerExpectation }
}
