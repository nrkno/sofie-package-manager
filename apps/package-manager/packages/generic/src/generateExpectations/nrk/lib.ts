import { AccessorId, PackageContainerId, protectString } from '@sofie-package-manager/api'

/**
 * Magic PackageContainer ID.
 * When a PackageContainer with this ID is present, it'll be used as for the "smartbull" feature.
 */
export const SMARTBULL_STORAGE_ID: PackageContainerId = protectString<PackageContainerId>('source-smartbull')

/**
 * Magic Temporary storage ID.
 * When a PackageContainer with this ID is present, it'll be used as for the "smartbull" feature.
 */
export const TEMPORARY_STORAGE_ID: PackageContainerId = protectString<PackageContainerId>('temporary-storage')

/**
 * Magic Source Monitor ID.
 * When a PackageContainer with this ID is present, it'll be used to monitor sources
 */
export const SOURCE_MONITOR_STORAGE_ID: PackageContainerId = protectString<PackageContainerId>('source_monitor')

/** Accessor that points to a Sofie Core collection */
export const CORE_COLLECTION_ACCESSOR_ID: AccessorId = protectString<AccessorId>('coreCollection')
