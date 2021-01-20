import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericAccessorHandle as GenericAccessorHandle } from './genericHandle'
import { LocalFolderAccessorHandle } from './localFolder'

export function getAccessorHandle(accessor: AccessorOnPackage.Any, content: unknown): GenericAccessorHandle {
	if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		return new LocalFolderAccessorHandle(accessor, content as any)
	} else if (accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO) {
		return new CorePackageInfoAccessorHandle(accessor, content as any)
	} else {
		throw new Error(`Unsupported Accessor type "${accessor.type}"`)
	}
}

export function isLocalFolderHandle(
	accessorHandler: GenericAccessorHandle
): accessorHandler is LocalFolderAccessorHandle {
	return accessorHandler.type === 'localFolder'
}
