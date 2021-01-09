import { ExpectedPackage, PackageOrigin } from '@sofie-automation/blueprints-integration'
import { ExpectedPackageWrap } from './packageManager'
import { Expectation } from './worker/expectationApi'
import { hashObj } from './worker/lib/lib'

export interface ExpectedPackageWrapMediaFile extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageMediaFile
	origins: ExpectedPackage.ExpectedPackageMediaFile['origins'][0]['originMetadata'][]
}
export interface ExpectedPackageWrapQuantel extends ExpectedPackageWrap {
	expectedPackage: ExpectedPackage.ExpectedPackageQuantelClip
	origins: ExpectedPackage.ExpectedPackageQuantelClip['origins'][0]['originMetadata'][]
}

export function generateExpectations(expectedPackages: ExpectedPackageWrap[]): { [id: string]: Expectation.Any } {
	const expectations: { [id: string]: Expectation.Any } = {}

	// Note: All of this is a preliminary implementation!
	// A blueprint-like plug-in architecture might be a future idea

	for (const expWrap of expectedPackages) {
		if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
			const expWrapMediaFile = expWrap as ExpectedPackageWrapMediaFile

			const exp: Expectation.MediaFileCopy = {
				id: '', // set later
				type: Expectation.Type.MEDIA_FILE_COPY,

				label: `${expWrapMediaFile.playoutDeviceId}: Media ${expWrapMediaFile.expectedPackage.content.filePath}`,

				startRequirement: {
					origins: expWrapMediaFile.origins,
				},

				endRequirement: {
					location: expWrapMediaFile.playoutLocation,
					content: expWrapMediaFile.expectedPackage.content,
					version: expWrapMediaFile.expectedPackage.version,
				},
			}
			exp.id = hashObj(exp.endRequirement)

			// TODO: what should happen if there are several that have the same endRequirement? join origins?

			expectations[exp.id] = exp
		} else if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.QUANTEL_CLIP) {
			const expWrapMediaFile = expWrap as ExpectedPackageWrapQuantel

			const content = expWrapMediaFile.expectedPackage.content
			const exp: Expectation.QuantelClipCopy = {
				id: '', // set later
				type: Expectation.Type.QUANTEL_COPY,

				label: `${expWrapMediaFile.playoutDeviceId}: Media ${content.title || content.guid}`,

				startRequirement: {
					origins: expWrapMediaFile.origins,
				},

				endRequirement: {
					location: expWrapMediaFile.playoutLocation, // todo
					content: content,
					version: expWrapMediaFile.expectedPackage.version,
				},
			}
			exp.id = hashObj(exp.endRequirement)

			// TODO: what should happen if there are several that have the same endRequirement? join origins?

			expectations[exp.id] = exp
		}
	}

	// Scan files:
	for (const id of Object.keys(expectations)) {
		const expectation = expectations[id]
		if (expectation.type === Expectation.Type.MEDIA_FILE_COPY) {
			const exp: Expectation.MediaFileScan = {
				id: expectation.id + '_scan',
				type: Expectation.Type.MEDIA_FILE_SCAN,

				label: `Scan ${expectation.label}`,

				startRequirement: expectation.endRequirement,

				endRequirement: {
					location: {
						type: PackageOrigin.OriginType.CORE_PACKAGE_INFO,
					},
					content: expectation.endRequirement.content,
					version: expectation.endRequirement.version,
				},
				triggerByFullfilledIds: [expectation.id],
			}
			expectations[exp.id] = exp
		}
	}

	return expectations
}
