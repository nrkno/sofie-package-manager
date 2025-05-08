import {
	getAccessorHandle,
	isFileShareAccessorHandle,
	isHTTPProxyAccessorHandle,
	isLocalFolderAccessorHandle,
} from '../../../accessorHandlers/accessor'
import { prioritizeAccessors } from '../../../lib/lib'
import { AccessorContext, GenericAccessorHandle } from '../../../accessorHandlers/genericHandle'
import { BaseWorker } from '../../../worker'
import { compareActualExpectVersions, findBestPackageContainerWithAccessToPackage } from '../lib/lib'
import { Diff } from 'deep-diff'
import {
	AccessorOnPackage,
	PackageContainerOnPackage,
	Expectation,
	Reason,
	ReturnTypeDoYouSupportExpectation,
	assertNever,
	AccessorId,
	promiseTimeout,
	INNER_ACTION_TIMEOUT,
	escapeFilePath,
	KnownReason,
} from '@sofie-package-manager/api'
import { LocalFolderAccessorHandle } from '../../../accessorHandlers/localFolder'
import { FileShareAccessorHandle } from '../../../accessorHandlers/fileShare'
import { HTTPProxyAccessorHandle } from '../../../accessorHandlers/httpProxy'

/** Check that a worker has access to the packageContainers through its accessors */
export function checkWorkerHasAccessToPackageContainersOnPackage(
	genericWorker: BaseWorker,
	checks: {
		sources?: PackageContainerOnPackage[]
		targets?: PackageContainerOnPackage[]
	}
): ReturnTypeDoYouSupportExpectation {
	let accessSourcePackageContainer: ReturnType<typeof findBestPackageContainerWithAccessToPackage>
	// Check that we have access to the packageContainers
	if (checks.sources !== undefined) {
		if (checks.sources.length === 0) {
			return {
				support: false,
				knownReason: true,
				reason: {
					user: `No sources configured`,
					tech: `No sources configured`,
				},
			}
		}
		accessSourcePackageContainer = findBestPackageContainerWithAccessToPackage(genericWorker, checks.sources)
		if (!accessSourcePackageContainer) {
			return {
				support: false,
				knownReason: true,
				reason: {
					user: `There is an issue with the configuration of the Worker, it doesn't have access to any of the source PackageContainers`,
					tech: `Worker doesn't have access to any of the source packageContainers (${checks.sources
						.map((o) => `"${o.containerId}": "${o.label}"`)
						.join(', ')})`,
				},
			}
		}
	}

	let accessTargetPackageContainer: ReturnType<typeof findBestPackageContainerWithAccessToPackage>
	if (checks.targets !== undefined) {
		if (checks.targets.length === 0) {
			return {
				support: false,
				knownReason: true,
				reason: {
					user: `No targets configured`,
					tech: `No targets configured`,
				},
			}
		}
		accessTargetPackageContainer = findBestPackageContainerWithAccessToPackage(genericWorker, checks.targets)
		if (!accessTargetPackageContainer) {
			return {
				support: false,
				knownReason: true,
				reason: {
					user: `There is an issue with the configuration of the Worker, it doesn't have access to any of the target PackageContainers`,
					tech: `Worker doesn't have access to any of the target packageContainers (${checks.targets
						.map((o) => `"${o.containerId}": "${o.label}"`)
						.join(', ')})`,
				},
			}
		}
	}

	// const hasAccessTo: string[] = []
	// if (accessSourcePackageContainer) {
	// 	hasAccessTo.push(
	// 		`source "${accessSourcePackageContainer.packageContainer.label}" through accessor "${accessSourcePackageContainer.accessorId}"`
	// 	)
	// }
	// if (accessTargetPackageContainer) {
	// 	hasAccessTo.push(
	// 		`target "${accessTargetPackageContainer.packageContainer.label}" through accessor "${accessTargetPackageContainer.accessorId}"`
	// 	)
	// }

	return {
		support: true,
		// reason: `Has access to ${hasAccessTo.join(' and ')}`,
	}
}

export type LookupPackageContainer<Metadata> =
	| {
			ready: true
			accessor: AccessorOnPackage.Any
			handle: GenericAccessorHandle<Metadata>
			// reason: Reason
	  }
	| {
			ready: false
			accessor: undefined
			// handle: undefined
			reason: Reason
			knownReason: KnownReason
	  }
export interface LookupChecks {
	/** Check that the accessor-handle supports reading */
	read?: boolean
	/** Check that the Package can be read */
	readPackage?: boolean
	/** Check that the version of the Package is correct */
	packageVersion?: Expectation.Version.ExpectAny

	/** Check that the accessor-handle supports writing */
	write?: boolean
	/** Check that it is possible to write to write to the package container */
	writePackageContainer?: boolean

	customCheck?: (
		packageContainer: PackageContainerOnPackage,
		accessorId: AccessorId,
		accessor: AccessorOnPackage.Any
	) => { success: true } | { success: false; knownReason: KnownReason; reason: Reason }
}
/** Go through the Accessors and return the best one that we can use for the expectation */
export async function lookupAccessorHandles<Metadata>(
	worker: BaseWorker,
	packageContainers: PackageContainerOnPackage[],
	accessorContext: AccessorContext,
	expectationContent: unknown,
	expectationWorkOptions: unknown,
	checks: LookupChecks
): Promise<LookupPackageContainer<Metadata>> {
	const prioritizedAccessors = prioritizeAccessors(packageContainers)

	return promiseTimeout<LookupPackageContainer<Metadata>>(
		(async () => {
			/** undefined if all good, error string otherwise */
			let errorReason:
				| undefined
				| {
						reason: Reason
						knownReason: KnownReason
				  } = {
				reason: { user: 'No target found', tech: 'No target found' },
				knownReason: true,
			}

			// See if the file is available at any of the targets:
			for (const { packageContainer, accessorId, accessor } of prioritizedAccessors) {
				errorReason = undefined

				const handle = getAccessorHandle<Metadata>(
					worker,
					accessorId,
					accessor,
					accessorContext,
					expectationContent,
					expectationWorkOptions
				)

				// Check that the accessor is valid at the most basic level:
				const basicResult = handle.checkHandleBasic()
				if (!basicResult.success) {
					errorReason = {
						reason: {
							user: `There is an issue with the Package: ${basicResult.reason.user})`,
							tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
								basicResult.reason.tech
							}`,
						},
						knownReason: basicResult.knownReason,
					}

					continue // Maybe next accessor works?
				}

				if (checks.read) {
					// Check that the accessor-handle supports reading:
					const readResult = handle.checkHandleRead()
					if (!readResult.success) {
						errorReason = {
							reason: {
								user: `There is an issue with the configuration for the PackageContainer "${
									packageContainer.label
								}" (on accessor "${accessor.label || accessorId}"): ${readResult.reason.user}`,
								tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
									readResult.reason.tech
								}`,
							},
							knownReason: readResult.knownReason,
						}
						continue // Maybe next accessor works?
					}
				}

				if (checks.readPackage) {
					// Check that the Package can be read:
					const readResult = await promiseTimeout(
						handle.checkPackageReadAccess(),
						INNER_ACTION_TIMEOUT,
						(duration) =>
							`Timeout after ${duration} ms in lookupAccessorHandles->checkPackageReadAccess for Accessor "${accessorId}", ${JSON.stringify(
								{
									expectationContent,
									expectationWorkOptions,
								}
							)}`
					)
					if (!readResult.success) {
						errorReason = {
							reason: {
								user: `Can't read the Package from PackageContainer "${
									packageContainer.label
								}" (on accessor "${accessor.label || accessorId}"), due to: ${readResult.reason.user}`,
								tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
									readResult.reason.tech
								}`,
							},
							knownReason: readResult.knownReason,
						}

						continue // Maybe next accessor works?
					}
				}
				if (checks.packageVersion !== undefined) {
					// Check that the version of the Package is correct:

					const actualSourceVersion = await promiseTimeout(
						handle.getPackageActualVersion(),
						INNER_ACTION_TIMEOUT,
						(duration) =>
							`Timeout after ${duration} ms in lookupAccessorHandles->getPackageActualVersion for Accessor "${accessorId}", ${JSON.stringify(
								{
									expectationContent,
									expectationWorkOptions,
								}
							)}`
					)

					const compareVersionResult = compareActualExpectVersions(actualSourceVersion, checks.packageVersion)
					if (!compareVersionResult.success) {
						errorReason = {
							reason: {
								user: `Won't read from the package, due to: ${compareVersionResult.reason.user}`,
								tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
									compareVersionResult.reason.tech
								}`,
							},
							knownReason: compareVersionResult.knownReason,
						}
						continue // Maybe next accessor works?
					}
				}

				if (checks.write) {
					// Check that the accessor-handle supports writing:
					const writeResult = handle.checkHandleWrite()
					if (!writeResult.success) {
						errorReason = {
							reason: {
								user: `There is an issue with the configuration for the PackageContainer "${
									packageContainer.label
								}" (on accessor "${accessor.label || accessorId}"): ${writeResult.reason.user}`,
								tech: `${packageContainer.label}: lookupTargets: Accessor "${
									accessor.label || accessorId
								}": ${writeResult.reason.tech}`,
							},
							knownReason: writeResult.knownReason,
						}
						continue // Maybe next accessor works?
					}
				}
				if (checks.writePackageContainer) {
					// Check that it is possible to write to write to the package container:

					const writeAccessResult = await promiseTimeout(
						handle.checkPackageContainerWriteAccess(),
						INNER_ACTION_TIMEOUT,
						(duration) =>
							`Timeout after ${duration} ms in lookupAccessorHandles->checkPackageContainerWriteAccess for Accessor "${accessorId}", ${JSON.stringify(
								{
									expectationContent,
									expectationWorkOptions,
								}
							)}`
					)

					if (!writeAccessResult.success) {
						errorReason = {
							reason: {
								user: `Can't write to the PackageContainer "${packageContainer.label}" (on accessor "${
									accessor.label || accessorId
								}"), due to: ${writeAccessResult.reason.user}`,
								tech: `${packageContainer.label}: Accessor "${accessor.label || accessorId}": ${
									writeAccessResult.reason.tech
								}`,
							},
							knownReason: writeAccessResult.knownReason,
						}
						continue // Maybe next accessor works?
					}
				}

				if (typeof checks.customCheck === 'function') {
					const checkResult = checks.customCheck(packageContainer, accessorId, accessor)
					if (!checkResult.success) {
						errorReason = {
							reason: {
								user: checkResult.reason.user,
								tech: checkResult.reason.tech,
							},
							knownReason: checkResult.knownReason,
						}
						continue // Maybe next accessor works?
					}
				}

				if (!errorReason) {
					// All good, no need to look further:
					return {
						accessor: accessor,
						handle: handle,
						ready: true,
					}
				}
			}
			return {
				accessor: undefined,
				ready: false,
				reason: errorReason?.reason,
				knownReason: errorReason?.knownReason,
			}
		})(),
		INNER_ACTION_TIMEOUT,
		(duration) =>
			`Timeout after ${duration} ms in lookupAccessorHandles. (${
				prioritizedAccessors.length
			} prioritizedAccessors, ${JSON.stringify({
				expectationContent,
				expectationWorkOptions,
				checks,
			})})`
	)
}

/** Converts a diff to some kind of user-readable string */
export function userReadableDiff<T>(diffs: Diff<T, T>[]): string {
	const strings: string[] = []
	for (const diff of diffs) {
		if (diff.kind === 'A') {
			// array
			// todo: deep explanation for arrays?
			strings.push((diff.path ? diff.path?.join('.') : '??') + `[${diff.index}]:` + '>>Array differs<<')
		} else if (diff.kind === 'E') {
			// edited
			strings.push((diff.path ? diff.path?.join('.') : '??') + `:"${diff.lhs}" not equal to "${diff.rhs}"`)
		} else if (diff.kind === 'D') {
			// deleted
			strings.push((diff.path ? diff.path?.join('.') : '??') + `:deleted`)
		} else if (diff.kind === 'N') {
			// new
			strings.push((diff.path ? diff.path?.join('.') : '??') + `:added`)
		}
	}
	return strings.join(', ')
}
function padTime(time: number, pad: number): string {
	return time.toString().padStart(pad, '0')
}
/** Formats a duration (in milliseconds) to a timecode ("00:00:00.000") */
export function formatTimeCode(duration: number): string {
	const SECOND = 1000
	const MINUTE = 60 * SECOND
	const HOUR = 60 * MINUTE

	const hours = Math.floor(duration / HOUR)
	duration -= hours * HOUR

	const minutes = Math.floor(duration / MINUTE)
	duration -= minutes * MINUTE

	const seconds = Math.floor(duration / SECOND)
	duration -= seconds * SECOND

	return `${padTime(hours, 2)}:${padTime(minutes, 2)}:${padTime(seconds, 2)}.${padTime(duration, 3)}`
}

interface PreviewMetadata {
	version: {
		bitrate: string
		height?: number
		width?: number
	}
}
/** Returns arguments for FFMpeg to generate a preview video file */
export function previewFFMpegArguments(input: string, seekableSource: boolean, metadata: PreviewMetadata): string[] {
	return [
		'-hide_banner',
		'-y', // Overwrite output files without asking.
		seekableSource ? undefined : '-seekable',
		seekableSource ? undefined : '0',
		`-i`,
		escapeFilePath(input), // Input file path
		'-f',
		'webm', // format: webm
		'-an', // blocks all audio streams
		'-c:v',
		'libvpx-vp9', // encoder for video (use VP9)
		`-b:v`,
		`${metadata.version.bitrate || '40k'}`,
		'-auto-alt-ref',
		'1',
		`-vf`,
		`scale=${metadata.version.width || 320}:${metadata.version.height || -1}`, // Scale to resolution

		'-threads',
		'1', // Number of threads to use
		'-cpu-used',
		'5', // Sacrifice quality for speed, used in combination with -deadline realtime
		'-deadline',
		'realtime', // Encoder speed/quality and cpu use (best, good, realtime)
	].filter(Boolean) as string[] // remove undefined values
}

interface ThumbnailMetadata {
	version: {
		height: number
		width: number
	}
}
/** Returns arguments for FFMpeg to generate a thumbnail image file */
export function thumbnailFFMpegArguments(
	input: string,
	metadata: ThumbnailMetadata,
	seekTimeCode?: string,
	hasVideoStream?: boolean
): string[] {
	return [
		'-hide_banner',
		...(hasVideoStream && seekTimeCode ? [`-ss`, `${seekTimeCode}`] : []),
		`-i`,
		escapeFilePath(input),
		`-f`,
		`image2`,
		'-frames:v',
		'1',
		...(hasVideoStream
			? [
					`-vf`,
					`${!seekTimeCode ? 'thumbnail,' : ''}scale=${metadata.version.width}:${metadata.version.height}`, // Creates a thumbnail of the video.
			  ]
			: [
					'-filter_complex',
					'showwavespic=s=640x240:split_channels=1:colors=white', // Creates an image of the audio waveform.
			  ]),

		'-threads',
		'1',
	]
}

/** Returns arguments for FFMpeg to generate a proxy video file */
export function proxyFFMpegArguments(
	input: string,
	seekableSource: boolean,
	targetHandle: LocalFolderAccessorHandle<any> | FileShareAccessorHandle<any> | HTTPProxyAccessorHandle<any>
): string[] {
	const args = [
		'-hide_banner',
		'-y', // Overwrite output files without asking.
		seekableSource ? undefined : '-seekable 0',
		`-i`,
		escapeFilePath(input), // Input file path

		'-c',
		'copy', // Stream copy, no transcoding
		'-threads',
		'1', // Number of threads to use
	]

	// Check target to see if we should tell ffmpeg which format to use:
	let targetPath = ''
	if (isLocalFolderAccessorHandle(targetHandle)) {
		targetPath = targetHandle.fullPath
	} else if (isFileShareAccessorHandle(targetHandle)) {
		targetPath = targetHandle.fullPath
	} else if (isHTTPProxyAccessorHandle(targetHandle)) {
		targetPath = ''
	} else {
		assertNever(targetHandle)
		throw new Error(`Unsupported Target AccessHandler`)
	}

	const hasFileExtension = targetPath.match(/\.[a-zA-Z0-9]{1,3}$/)
	if (!hasFileExtension) {
		args.push(
			'-f mp4' // Specify format. Note: There's no reason why mp4 was picked here, perhaps change this in the future?
		)
	}

	return args.filter(Boolean) as string[] // remove undefined values
}
