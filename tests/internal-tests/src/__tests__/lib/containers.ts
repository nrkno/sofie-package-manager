import {
	Accessor,
	AccessorId,
	AccessorOnPackage,
	Expectation,
	PackageContainerId,
	literal,
	protectString,
} from '@sofie-package-manager/api'

export const LOCAL0 = protectString<AccessorId>('local0')
export const SHARE0 = protectString<AccessorId>('share0')
export const QUANTEL0 = protectString<AccessorId>('quantel0')

export function getLocalSource(
	containerId: PackageContainerId,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.FileSource {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			[LOCAL0]: literal<AccessorOnPackage.LocalFolder>({
				type: Accessor.AccessType.LOCAL_FOLDER,
				filePath: filePath,
				folderPath: `/sources/${containerId}/`,
				allowRead: true,
			}),
		},
	}
}
export function getLocalTarget(
	containerId: PackageContainerId,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.FileTarget {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			[LOCAL0]: literal<AccessorOnPackage.LocalFolder>({
				type: Accessor.AccessType.LOCAL_FOLDER,
				filePath: filePath,
				folderPath: `/targets/${containerId}/`,
				allowRead: true,
				allowWrite: true,
			}),
		},
	}
}

export function getFileShareSource(
	containerId: PackageContainerId,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.FileSource {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			[SHARE0]: literal<AccessorOnPackage.FileShare>({
				type: Accessor.AccessType.FILE_SHARE,
				filePath: filePath,
				folderPath: `\\\\networkShare\\sources\\${containerId}\\`,
				allowRead: true,
			}),
		},
	}
}
export function getFileShareTarget(
	containerId: PackageContainerId,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.FileTarget {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			[SHARE0]: literal<AccessorOnPackage.FileShare>({
				type: Accessor.AccessType.FILE_SHARE,
				filePath: filePath,
				folderPath: `\\\\networkShare\\${containerId}\\`,
				allowRead: true,
				allowWrite: true,
			}),
		},
	}
}
export function getQuantelSource(
	containerId: PackageContainerId
): Expectation.SpecificPackageContainerOnPackage.QuantelClip {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			[QUANTEL0]: literal<AccessorOnPackage.Quantel>({
				type: Accessor.AccessType.QUANTEL,
				quantelGatewayUrl: 'http://192.168.0.1',
				ISAUrls: ['127.0.0.1'],
				// zoneId?: string;
				// serverId?: number;
				// networkId?: string;
				allowRead: true,
			}),
		},
	}
}
export function getQuantelTarget(
	containerId: PackageContainerId,
	serverId: number
): Expectation.SpecificPackageContainerOnPackage.QuantelClip {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			[QUANTEL0]: literal<AccessorOnPackage.Quantel>({
				type: Accessor.AccessType.QUANTEL,
				quantelGatewayUrl: 'http://192.168.0.1',
				ISAUrls: ['127.0.0.1'],
				// zoneId?: string;
				serverId: serverId,
				// networkId?: string;
				allowRead: true,
				allowWrite: true,
			}),
		},
	}
}
