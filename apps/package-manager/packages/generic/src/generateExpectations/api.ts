import {
	ActivePlaylist,
	ActiveRundown,
	ExpectedPackageWrap,
	PackageContainers,
	PackageManagerSettings,
} from '../packageManager'
import { Expectation, LoggerInstance, PackageContainerExpectation } from '@shared/api'

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
