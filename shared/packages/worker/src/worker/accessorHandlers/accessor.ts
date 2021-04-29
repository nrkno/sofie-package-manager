import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../worker'
import { CorePackageInfoAccessorHandle } from './corePackageInfo'
import { FileShareAccessorHandle } from './fileShare'
import { GenericAccessorHandle } from './genericHandle'
import { HTTPAccessorHandle } from './http'
import { LocalFolderAccessorHandle } from './localFolder'
import { QuantelAccessorHandle } from './quantel'

export function getAccessorHandle<Metadata>(
	worker: GenericWorker,
	accessor: AccessorOnPackage.Any,
	content: unknown,
	workOptions: unknown
): GenericAccessorHandle<Metadata> {
	const HandleClass = getAccessorStaticHandle(accessor)

	// For some reason, tsc complains about build error TS2351: This expression is not constructable:
	// But it works..!
	return new (HandleClass as any)(worker, accessor as any, content as any, workOptions as any)
}
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function getAccessorStaticHandle(accessor: AccessorOnPackage.Any) {
	if (accessor.type === undefined) {
		throw new Error(`getAccessorStaticHandle: Accessor type is undefined`)
	} else if (accessor.type === Accessor.AccessType.LOCAL_FOLDER) {
		return LocalFolderAccessorHandle
	} else if (accessor.type === Accessor.AccessType.CORE_PACKAGE_INFO) {
		return CorePackageInfoAccessorHandle
	} else if (accessor.type === Accessor.AccessType.HTTP) {
		return HTTPAccessorHandle
	} else if (accessor.type === Accessor.AccessType.FILE_SHARE) {
		return FileShareAccessorHandle
	} else if (accessor.type === Accessor.AccessType.QUANTEL) {
		return QuantelAccessorHandle
	} else {
		assertNever(accessor.type) // Assert  so as to not forget to add an if-clause above
		throw new Error(`Unsupported Accessor type "${accessor.type}"`)
	}
}
function assertNever(_shouldBeNever: never) {
	// Nothing
}

export function isLocalFolderHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is LocalFolderAccessorHandle<Metadata> {
	return accessorHandler.type === LocalFolderAccessorHandle.type
}
export function isCorePackageInfoAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is CorePackageInfoAccessorHandle<Metadata> {
	return accessorHandler.type === CorePackageInfoAccessorHandle.type
}
export function isHTTPAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is HTTPAccessorHandle<Metadata> {
	return accessorHandler.type === HTTPAccessorHandle.type
}
export function isFileShareAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is FileShareAccessorHandle<Metadata> {
	return accessorHandler.type === FileShareAccessorHandle.type
}
export function isQuantelClipAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is QuantelAccessorHandle<Metadata> {
	return accessorHandler.type === QuantelAccessorHandle.type
}
