import {
	Accessor,
	AccessorId,
	AccessorOnPackage,
	Expectation,
	ExpectationId,
	ExpectationManagerId,
	ExpectedPackageId,
	PackageContainerExpectation,
	PackageContainerId,
	literal,
	protectString,
} from '@sofie-package-manager/api'
export const STEP0 = protectString<ExpectationId>('step0')
export const MANAGER0 = protectString<ExpectationManagerId>('manager0')
export const PACKAGE0 = protectString<ExpectedPackageId>('package0')
export const LOCAL0 = protectString<AccessorId>('local0')
export const SOURCE0 = protectString<PackageContainerId>('source0')
export const TARGET0 = protectString<PackageContainerId>('target0')

export function getAccessors(containerId: PackageContainerId): { [accessorId: AccessorId]: Accessor.Any } {
	return {
		[LOCAL0]: literal<Accessor.LocalFolder>({
			type: Accessor.AccessType.LOCAL_FOLDER,
			folderPath: `/sources/${containerId}/`,
			allowWrite: false,
			allowRead: true,
			label: 'Test',
		}),
	}
}

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

export function getFileCopyExpectation(): Expectation.FileCopy {
	return literal<Expectation.FileCopy>({
		id: STEP0,
		priority: 0,
		managerId: MANAGER0,
		fromPackages: [{ id: PACKAGE0, expectedContentVersionHash: 'abcd1234' }],
		type: Expectation.Type.FILE_COPY,
		statusReport: {
			label: `Copy file0`,
			description: '',
			sendReport: true,
		},
		startRequirement: {
			sources: [getLocalSource(SOURCE0, 'file0Source.mp4')],
		},
		endRequirement: {
			targets: [getLocalTarget(TARGET0, 'myFolder/file0Target.mp4')],
			content: {
				filePath: 'file0Target.mp4',
			},
			version: { type: Expectation.Version.Type.FILE_ON_DISK },
		},
		workOptions: {},
	})
}

export function getPackageContainerExpectation(): PackageContainerExpectation {
	return literal<PackageContainerExpectation>({
		id: SOURCE0,
		accessors: getAccessors(SOURCE0),
		cronjobs: {},
		label: 'Mock Expectation',
		managerId: MANAGER0,
		monitors: {
			packages: {
				label: 'Mock Package Monitor',
				targetLayers: ['layer0'],
			},
		},
	})
}
