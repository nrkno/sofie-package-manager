import { Accessor, AccessorOnPackage, PackageContainerOnPackage } from '@sofie-automation/blueprints-integration'
import * as crypto from 'crypto'
import * as _ from 'underscore'

export function literal<T>(o: T): T {
	return o
}
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function hashObj(obj: any): string {
	if (!obj) {
		return ''
	} else if (_.isArray(obj)) {
		const strs: string[] = []
		for (const value of obj) {
			strs.push(hashObj(value))
		}
		return hash(strs.join(','))
	} else if (typeof obj === 'object') {
		// Sort the keys, so that key order doesn't matter:
		const keys = Object.keys(obj).sort((a, b) => {
			if (a > b) return 1
			if (a < b) return -1
			return 0
		})

		const strs: string[] = []
		for (const key of keys) {
			strs.push(hashObj(obj[key]))
		}
		return hash(strs.join('|'))
	} else {
		return obj + ''
	}
}
export function hash(str: string): string {
	const hash = crypto.createHash('sha1')
	return hash.update(str).digest('hex')
}
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
