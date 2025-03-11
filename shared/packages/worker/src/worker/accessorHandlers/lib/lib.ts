import { AccessorOnPackage } from '@sofie-package-manager/api'
import { AccessorHandlerCheckHandleReadResult, AccessorHandlerCheckHandleWriteResult } from '../genericHandle'

export function defaultCheckHandleRead(
	accessor: AccessorOnPackage.Any
): AccessorHandlerCheckHandleReadResult | undefined {
	if (!accessor.allowRead) {
		return {
			success: false,
			knownReason: true,
			reason: {
				user: `Not allowed to read (in configuration)`,
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
			knownReason: true,
			reason: {
				user: `Not allowed to write (in configuration)`,
				tech: `Not allowed to write (check PackageContainer settings)`,
			},
		}
	}
	return undefined
}
