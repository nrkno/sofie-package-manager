import { ActivePlaylist, ActiveRundown, ExpectedPackageWrap, PackageContainers } from '../packageManager'
import { PackageManagerSettings } from '../generated/options'
import { Expectation, LoggerInstance, PackageContainerExpectation } from '@sofie-package-manager/api'

export interface GenerateExpectationApi {
	getExpectations: (
		logger: LoggerInstance,
		managerId: string,
		packageContainers: PackageContainers,
		_activePlaylist: ActivePlaylist,
		activeRundowns: ActiveRundown[],
		expectedPackages: ExpectedPackageWrap[],
		settings: PackageManagerSettings
	) => { [id: string]: Expectation.Any }

	getPackageContainerExpectations: (
		managerId: string,
		packageContainers: PackageContainers,
		_activePlaylist: ActivePlaylist
	) => { [id: string]: PackageContainerExpectation }
}
