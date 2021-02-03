import { Accessor, AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'

export function prioritizeAccessors<T extends PackageContainerOnPackage>(
	packageContainers: T[]
): AccessorWithPackageContainer<T>[] {
	const accessors: AccessorWithPackageContainer<T>[] = []
	const accessorTypePriority: { [key: string]: number } = {
		[Accessor.AccessType.LOCAL_FOLDER]: 0,
		[Accessor.AccessType.QUANTEL]: 1,
		[Accessor.AccessType.FILE_SHARE]: 2,
		[Accessor.AccessType.HTTP]: 3,
		[Accessor.AccessType.CORE_PACKAGE_INFO]: 99999,
	}
	for (const packageContainer of packageContainers) {
		for (const [accessorId, accessor] of Object.entries(packageContainer.accessors)) {
			accessors.push({
				packageContainer,
				accessor,
				accessorId,
				prio: accessorTypePriority[(accessor.type as unknown) as string] || 10,
			})
		}
	}
	accessors.sort((a, b) => {
		if (a.prio > b.prio) return 1
		if (a.prio < b.prio) return -1

		return 0
	})

	return accessors
}
export interface AccessorWithPackageContainer<T extends PackageContainerOnPackage> {
	packageContainer: T
	accessor: AccessorOnPackage.Any
	accessorId: string
	prio: number
}
