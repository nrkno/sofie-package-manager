import { ExpectedPackage } from '@sofie-automation/blueprints-integration'
import { ExpectedPackageWrap } from './packageManager'
import { Expectation } from './worker/expectationApi'
import * as crypto from 'crypto'

export function generateExpectations(expectedPackages: ExpectedPackageWrap[]): { [id: string]: Expectation.Any } {
	const expectations: { [id: string]: Expectation.Any } = {}

	// Note: All of this is a preliminary implementation!
	// A blueprint-like plug-in architecture might be a future idea

	for (const expWrap of expectedPackages) {
		if (expWrap.expectedPackage.type === ExpectedPackage.PackageType.MEDIA_FILE) {
			const exp: Expectation.ExpectationMediaFile = {
				id: '', // set later
				type: Expectation.Type.MEDIA_FILE_COPY,

				label: `${expWrap.playoutDeviceId}: Media ${expWrap.expectedPackage.content.filePath}`,

				startRequirement: {
					origins: expWrap.origins,
				},

				endRequirement: {
					location: expWrap.playoutLocation, // todo
					filePath: expWrap.expectedPackage.content.filePath,
					version: expWrap.expectedPackage.version,
				},
			}
			exp.id = hashObj(exp.endRequirement)

			// TODO: what should happen if there are several that have the same endRequirement? join origins?

			expectations[exp.id] = exp
		}
	}

	return expectations
}

function hashObj(obj: any): string {
	if (typeof obj === 'object') {
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
	}
	return obj + ''
}
function hash(str: string): string {
	const hash = crypto.createHash('sha1')
	return hash.update(str).digest('hex')
}
