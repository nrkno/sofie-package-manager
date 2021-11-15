import * as BI from '@sofie-automation/blueprints-integration'
import { assertTrue, EnumExtends, Equals, assertEnumValuesExtends } from './lib'
/* eslint-disable @typescript-eslint/no-namespace */

/*
	This file contains a few of the package-related types from blueprints-integration.
	Other libraries should (when possible) refer to these types instead of blueprints-integration directly.

	The reason for this is to allow for easier addition of custom types without
	having to update the blueprints-integration library.

	Note: When adding types in this file, consider opening a PR to Sofie Core (https://github.com/nrkno/tv-automation-server-core)
	later to add it into blueprints-integration.
*/

export const StatusCode = BI.StatusCode
export type StatusCode = BI.StatusCode

export namespace ExpectedPackage {
	export type Any = AnyFromBI

	// re-export the BI types:
	export type ExpectedPackageMediaFile = BI.ExpectedPackage.ExpectedPackageMediaFile
	export type ExpectedPackageQuantelClip = BI.ExpectedPackage.ExpectedPackageQuantelClip
	export type ExpectedPackageJSONData = BI.ExpectedPackage.ExpectedPackageJSONData

	// Assert that the re-exported types are correct:
	type AnyFromBI = ExpectedPackageMediaFile | ExpectedPackageQuantelClip | ExpectedPackageJSONData
	assertTrue<Equals<AnyFromBI, BI.ExpectedPackage.Any>>()

	export type Base = BI.ExpectedPackage.Base
	export type SideEffectPreviewSettings = BI.ExpectedPackage.SideEffectPreviewSettings
	export type SideEffectThumbnailSettings = BI.ExpectedPackage.SideEffectThumbnailSettings

	// Note: since TS doesn't support extending enums, this is a hack to make it work for now:
	// (see https://github.com/microsoft/TypeScript/issues/17592 )
	export enum PackageType {
		// Types from blueprints-integration: -------------
		MEDIA_FILE = 'media_file',
		QUANTEL_CLIP = 'quantel_clip',
		JSON_DATA = 'json_data',
		// Extended types: -------------------------------
	}

	// Assert that the enum includes all of the original enum values:
	assertTrue<EnumExtends<typeof PackageType, typeof BI.ExpectedPackage.PackageType>>()
	assertEnumValuesExtends(PackageType, BI.ExpectedPackage.PackageType)
}

export namespace Accessor {
	export type Any = AnyFromBI

	// re-export the BI types:
	export type LocalFolder = BI.Accessor.LocalFolder
	export type FileShare = BI.Accessor.FileShare
	export type HTTP = BI.Accessor.HTTP
	export type HTTPProxy = BI.Accessor.HTTPProxy
	export type Quantel = BI.Accessor.Quantel
	export type CorePackageCollection = BI.Accessor.CorePackageCollection

	// Assert that the re-exported types are correct:
	type AnyFromBI = LocalFolder | FileShare | HTTP | HTTPProxy | Quantel | CorePackageCollection
	assertTrue<Equals<AnyFromBI, BI.Accessor.Any>>()

	export type Base = BI.Accessor.Base

	// Note: since TS doesn't support extending enums, this is a hack to make it work for now:
	// (see https://github.com/microsoft/TypeScript/issues/17592 )
	export enum AccessType {
		// Types from blueprints-integration: -------------
		LOCAL_FOLDER = 'local_folder',
		FILE_SHARE = 'file_share',
		HTTP = 'http',
		HTTP_PROXY = 'http_proxy',
		QUANTEL = 'quantel',
		CORE_PACKAGE_INFO = 'core_package_info',
		// Extended types: -------------------------------
	}

	// Assert that the enum includes all of the original enum values:
	assertTrue<EnumExtends<typeof AccessType, typeof BI.Accessor.AccessType>>()
	assertEnumValuesExtends(AccessType, BI.Accessor.AccessType)
}

// assertEnumValuesExtends(A, B)

export namespace AccessorOnPackage {
	export type Any = AnyFromBI

	// re-export the BI types:
	export type LocalFolder = BI.AccessorOnPackage.LocalFolder
	export type FileShare = BI.AccessorOnPackage.FileShare
	export type HTTP = BI.AccessorOnPackage.HTTP
	export type HTTPProxy = BI.AccessorOnPackage.HTTPProxy
	export type Quantel = BI.AccessorOnPackage.Quantel
	export type CorePackageCollection = BI.AccessorOnPackage.CorePackageCollection

	// Assert that the re-exported types are correct:
	type AnyFromBI = LocalFolder | FileShare | HTTP | HTTPProxy | Quantel | CorePackageCollection
	assertTrue<Equals<AnyFromBI, BI.AccessorOnPackage.Any>>()
}
export type PackageContainer = BI.PackageContainer
export type PackageContainerOnPackage = BI.PackageContainerOnPackage

// Note: Not re-exporting ExpectedPackageStatusAPI in this file, since that is purely a Sofie-Core API
