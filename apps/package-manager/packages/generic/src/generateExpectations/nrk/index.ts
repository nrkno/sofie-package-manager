import { GenerateExpectationApi } from '../api'
import { getExpectations } from './expectations'
import { getPackageContainerExpectations } from './packageContainerExpectations'

export const api: GenerateExpectationApi = {
	getExpectations: getExpectations,
	getPackageContainerExpectations: getPackageContainerExpectations,
}
