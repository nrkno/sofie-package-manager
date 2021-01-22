import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../worker'
import { CorePackageInfoAccessorHandle } from './corePackageInfo'
import { FileShareAccessorHandle } from './fileShare'
import { GenericAccessorHandle } from './genericHandle'
import { HTTPAccessorHandle } from './http'
import { LocalFolderAccessorHandle } from './localFolder'

export function getAccessorHandle<Metadata>(
	worker: GenericWorker,
	accessor: AccessorOnPackage.Any,
	content: unknown
): GenericAccessorHandle<Metadata> {
	if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		return new LocalFolderAccessorHandle(worker, accessor, content as any)
	} else if (accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO) {
		return new CorePackageInfoAccessorHandle(worker, accessor, content as any)
	} else if (accessor.type === Accessor.AccessType.HTTP) {
		return new HTTPAccessorHandle(worker, accessor, content as any)
	} else if (accessor.type === Accessor.AccessType.FILE_SHARE) {
		return new FileShareAccessorHandle(worker, accessor, content as any)
	} else {
		throw new Error(`Unsupported Accessor type "${accessor.type}"`)
	}
}

export function isLocalFolderHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is LocalFolderAccessorHandle<Metadata> {
	return accessorHandler.type === 'localFolder'
}
export function isCorePackageInfoAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is CorePackageInfoAccessorHandle<Metadata> {
	return accessorHandler.type === 'corePackageInfo'
}
export function isHTTPAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is HTTPAccessorHandle<Metadata> {
	return accessorHandler.type === 'http'
}
export function isFileShareAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is FileShareAccessorHandle<Metadata> {
	return accessorHandler.type === 'fileShare'
}
