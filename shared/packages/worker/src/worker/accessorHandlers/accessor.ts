import { assertNever, Accessor, AccessorOnPackage, AccessorId } from '@sofie-package-manager/api'
import { BaseWorker } from '../worker'
import { CorePackageInfoAccessorHandle } from './corePackageInfo'
import { FileShareAccessorHandle } from './fileShare'
import { AccessorConstructorProps, AccessorContext, GenericAccessorHandle } from './genericHandle'
import { HTTPAccessorHandle } from './http'
import { HTTPProxyAccessorHandle } from './httpProxy'
import { LocalFolderAccessorHandle } from './localFolder'
import { QuantelAccessorHandle } from './quantel'
import { ATEMAccessorHandle } from './atem'

export function getAccessorHandle<Metadata>(
	worker: BaseWorker,
	accessorId: AccessorId,
	accessor: AccessorOnPackage.Any,
	accessorContext: AccessorContext,
	content: unknown,
	workOptions: unknown
): GenericAccessorHandle<Metadata> {
	const HandleClass = getAccessorStaticHandle(accessor)

	const constructorOptions: AccessorConstructorProps<AccessorOnPackage.Any> = {
		worker: worker,
		accessorId: accessorId,
		accessor: accessor as any,
		context: accessorContext,
		content: content as any,
		workOptions: workOptions as any,
	}

	// For some reason, tsc complains about build error TS2351: This expression is not constructable:
	// But it works..!
	return new (HandleClass as any)(constructorOptions)
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
	} else if (accessor.type === Accessor.AccessType.HTTP_PROXY) {
		return HTTPProxyAccessorHandle
	} else if (accessor.type === Accessor.AccessType.FILE_SHARE) {
		if (process.platform !== 'win32') throw new Error(`FileShareAccessor: not supported on ${process.platform}`)
		return FileShareAccessorHandle
	} else if (accessor.type === Accessor.AccessType.QUANTEL) {
		return QuantelAccessorHandle
	} else if (accessor.type === Accessor.AccessType.ATEM_MEDIA_STORE) {
		return ATEMAccessorHandle
	} else {
		assertNever(accessor.type) // Assert  so as to not forget to add an if-clause above
		throw new Error(`Unsupported Accessor type "${accessor.type}"`)
	}
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
export function isHTTPProxyAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is HTTPProxyAccessorHandle<Metadata> {
	return accessorHandler.type === HTTPProxyAccessorHandle.type
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
export function isATEMAccessorHandle<Metadata>(
	accessorHandler: GenericAccessorHandle<Metadata>
): accessorHandler is ATEMAccessorHandle<Metadata> {
	return accessorHandler.type === ATEMAccessorHandle.type
}

/** Returns a generic value for how costly it is to use an Accessor type. A higher value means that it is more expensive to access the accessor */
export function getAccessorCost(accessorType: Accessor.AccessType | undefined): number {
	switch (accessorType) {
		// --------------------------------------------------------
		case Accessor.AccessType.LOCAL_FOLDER:
			return 1
		case Accessor.AccessType.QUANTEL:
			return 1
		case Accessor.AccessType.ATEM_MEDIA_STORE:
			return 1
		case Accessor.AccessType.CORE_PACKAGE_INFO:
			return 2
		// --------------------------------------------------------
		case Accessor.AccessType.FILE_SHARE:
			return 2
		case Accessor.AccessType.HTTP_PROXY:
		case Accessor.AccessType.HTTP:
			return 3

		case undefined:
			return 999
		default:
			assertNever(accessorType)
			return 999
	}
}
