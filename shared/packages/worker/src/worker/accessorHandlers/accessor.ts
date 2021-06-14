import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { GenericWorker } from '../worker'
import { CorePackageInfoAccessorHandle } from './corePackageInfo'
import { FileShareAccessorHandle } from './fileShare'
import { FTPAccessorHandle } from './ftp'
import { GenericAccessorHandle } from './genericHandle'
import { HTTPAccessorHandle } from './http'
import { LocalFolderAccessorHandle } from './localFolder'
import { QuantelAccessorHandle } from './quantel'

export function getAccessorHandle<Metadata>(
	worker: GenericWorker,
	accessorId: string,
	accessor: AccessorOnPackage.Any,
	content: unknown,
	workOptions: unknown
): GenericAccessorHandle<Metadata> {
	const HandleClass = getAccessorStaticHandle(accessor)

	// For some reason, tsc complains about build error TS2351: This expression is not constructable:
	// But it works..!
	return new (HandleClass as any)(worker, accessorId, accessor as any, content as any, workOptions as any)
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
	} else if (accessor.type === Accessor.AccessType.FTP) {
		return FTPAccessorHandle
	} else {
		assertNever(accessor.type) // Assert  so as to not forget to add an if-clause above
		throw new Error(`Unsupported Accessor type "${accessor.type}"`)
	}
}
function assertNever(_shouldBeNever: never) {
	// Nothing
}

export function isLocalFolderAccessorHandle<Metadata>(
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

export function isFTPAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is FTPAccessorHandle<Metadata> {
	return accessorHandler.type === FTPAccessorHandle.type
}

/** Returns a generic value for how costly it is to use an Accessor type. A higher value means that it is more expensive to access the accessor */
export function getAccessorCost(accessorType: Accessor.AccessType | undefined): number {
	switch (accessorType) {
		// --------------------------------------------------------
		case Accessor.AccessType.LOCAL_FOLDER:
			return 1
		case Accessor.AccessType.QUANTEL:
			return 1
		case Accessor.AccessType.CORE_PACKAGE_INFO:
			return 2
		// --------------------------------------------------------
		case Accessor.AccessType.FILE_SHARE:
			return 2
		case Accessor.AccessType.HTTP:
		case Accessor.AccessType.FTP:
			return 3

		case undefined:
			return 999
		default:
			assertNever(accessorType)
			return 999
	}
}
