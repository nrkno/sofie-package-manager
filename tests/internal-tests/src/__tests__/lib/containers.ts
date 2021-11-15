import { Accessor, AccessorOnPackage, Expectation, literal } from '@shared/api'

export function getLocalSource(
	containerId: string,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.File {
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
export function getLocalTarget(
	containerId: string,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.File {
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

export function getFileShareSource(
	containerId: string,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.File {
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
export function getFileShareTarget(
	containerId: string,
	filePath: string
): Expectation.SpecificPackageContainerOnPackage.File {
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
export function getQuantelSource(containerId: string): Expectation.SpecificPackageContainerOnPackage.QuantelClip {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			quantel0: literal<AccessorOnPackage.Quantel>({
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
	containerId: string,
	serverId: number
): Expectation.SpecificPackageContainerOnPackage.QuantelClip {
	return {
		containerId: containerId,
		label: `Label ${containerId}`,
		accessors: {
			quantel0: literal<AccessorOnPackage.Quantel>({
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
