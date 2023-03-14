import { AccessorOnPackage } from '@sofie-package-manager/input-api'
import { AccessorHandlerCheckHandleReadResult, AccessorHandlerCheckHandleWriteResult } from '../genericHandle'

export function defaultCheckHandleRead(
	accessor: AccessorOnPackage.Any
): AccessorHandlerCheckHandleReadResult | undefined {
	if (!accessor.allowRead) {
		return {
			success: false,
			reason: {
				user: `Not allowed to read`,
				tech: `Not allowed to read  (check PackageContainer settings)`,
			},
		}
	}
	return undefined
}
export function defaultCheckHandleWrite(
	accessor: AccessorOnPackage.Any
): AccessorHandlerCheckHandleWriteResult | undefined {
	if (!accessor.allowWrite) {
		return {
			success: false,
			reason: {
				user: `Not allowed to write`,
				tech: `Not allowed to write (check PackageContainer settings)`,
			},
		}
	}
	return undefined
}
