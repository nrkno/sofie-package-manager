import { Expectation } from '../../../expectationApi'

export function compareActualExpectVersions(
	actualVersion: Expectation.Version.Any,
	expectVersion: Expectation.Version.ExpectAny
): undefined | string {
	let errorReason: string | undefined = undefined

	if (expectVersion.type !== actualVersion.type) {
		errorReason = `Actual version type differs from expected (${expectVersion.type}, ${actualVersion.type})`
	}

	if (
		actualVersion.type === Expectation.Version.Type.MEDIA_FILE &&
		expectVersion.type === Expectation.Version.Type.MEDIA_FILE
	) {
		if (expectVersion.fileSize && expectVersion.fileSize !== actualVersion.fileSize) {
			errorReason = `Actual file size differ from expected (${expectVersion.fileSize}, ${actualVersion.fileSize})`
		}
		if (expectVersion.modifiedDate && expectVersion.modifiedDate !== actualVersion.modifiedDate) {
			errorReason = `Actual modified date differ from expected (${expectVersion.modifiedDate}, ${actualVersion.modifiedDate})`
		}
		// Todo: checksum?
	} else {
		throw new Error(`compareActualExpectVersions: Unsupported type "${expectVersion.type}"`)
	}

	return errorReason
}
export function compareActualVersions(
	actualVersionSource: Expectation.Version.Any,
	actualVersionTarget: Expectation.Version.Any
): undefined | string {
	let errorReason: string | undefined = undefined

	if (actualVersionSource.type !== actualVersionTarget.type) {
		errorReason = `Source/Target versions type differs (${actualVersionSource.type}, ${actualVersionTarget.type})`
	}

	if (
		actualVersionSource.type === Expectation.Version.Type.MEDIA_FILE &&
		actualVersionTarget.type === Expectation.Version.Type.MEDIA_FILE
	) {
		if (actualVersionSource.fileSize && actualVersionSource.fileSize !== actualVersionTarget.fileSize) {
			errorReason = `Target file size differ from source (${actualVersionSource.fileSize}, ${actualVersionTarget.fileSize})`
		}
		if (actualVersionSource.modifiedDate && actualVersionSource.modifiedDate !== actualVersionTarget.modifiedDate) {
			errorReason = `Target modified date differ from source (${actualVersionSource.modifiedDate}, ${actualVersionTarget.modifiedDate})`
		}
		// Todo: checksum?
	} else {
		throw new Error(`compareActualVersions: Unsupported type "${actualVersionSource.type}"`)
	}

	return errorReason
}
