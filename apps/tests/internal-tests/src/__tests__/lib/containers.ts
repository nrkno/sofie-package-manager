import { Expectation, literal } from '@shared/api'
import { Accessor, AccessorOnPackage } from '@sofie-automation/blueprints-integration'

export function getLocalSource(containerId: string, filePath: string): Expectation.PackageContainerOnPackageFile {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			local0: literal<AccessorOnPackage.LocalFolder>({
				type: Accessor.AccessType.LOCAL_FOLDER,
				filePath: filePath,
				folderPath: `/sources/${containerId}/`,
				allowRead: true,
			}),
		},
	}
}
export function getLocalTarget(containerId: string, filePath: string): Expectation.PackageContainerOnPackageFile {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			local0: literal<AccessorOnPackage.LocalFolder>({
				type: Accessor.AccessType.LOCAL_FOLDER,
				filePath: filePath,
				folderPath: `/targets/${containerId}/`,
				allowRead: true,
				allowWrite: true,
			}),
		},
	}
}

export function getFileShareSource(containerId: string, filePath: string): Expectation.PackageContainerOnPackageFile {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			share0: literal<AccessorOnPackage.FileShare>({
				type: Accessor.AccessType.FILE_SHARE,
				filePath: filePath,
				folderPath: `\\\\networkShare\\sources\\${containerId}\\`,
				allowRead: true,
			}),
		},
	}
}
export function getFileShareTarget(containerId: string, filePath: string): Expectation.PackageContainerOnPackageFile {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			share0: literal<AccessorOnPackage.FileShare>({
				type: Accessor.AccessType.FILE_SHARE,
				filePath: filePath,
				folderPath: `\\\\networkShare\\${containerId}\\`,
				allowRead: true,
				allowWrite: true,
			}),
		},
	}
}
