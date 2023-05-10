import { Accessor, Expectation, ExpectedPackage, literal, LoggerInstance } from '@sofie-package-manager/api'
import * as NRK from '..'
import {
	ActivePlaylist,
	ActiveRundown,
	ExpectedPackageWrap,
	PackageContainers,
	wrapExpectedPackage,
} from '../../../packageManager'
import { PackageManagerSettings } from '../../../generated/options'

describe('Generate expectations - NRK', () => {
	test('Wrap package', () => {
		const o = setup()

		const wrapped = wrapExpectedPackage(o.packageContainers, o.packages.simpleMedia)

		expect(wrapped).toBeTruthy()
		expect(wrapped).toMatchObject({
			sources: [
				{
					containerId: 'source0',
				},
			],
			targets: [
				{
					containerId: 'target0',
				},
			],
		})
	})
	test('Empty', () => {
		const o = setup()
		const expectedPackages: ExpectedPackageWrap[] = []

		const expectations = NRK.api.getExpectations(
			o.logger,
			'test',
			o.packageContainers,
			o.activePlaylist,
			o.activeRundowns,
			expectedPackages,
			o.settings
		)

		expect(Object.keys(expectations)).toHaveLength(0)
	})
	test('Simple package', () => {
		const o = setup()

		const expectedPackages: ExpectedPackageWrap[] = [wrap(o.packageContainers, o.packages.simpleMedia, true)]

		const expectations = NRK.api.getExpectations(
			o.logger,
			'test',
			o.packageContainers,
			o.activePlaylist,
			o.activeRundowns,
			expectedPackages,
			o.settings
		)

		expect(Object.keys(expectations)).toHaveLength(6) // copy, scan, deep-scan, thumbnail, preview, loudness
		// expect(expectations).toMatchSnapshot()

		const eCopy = Object.values(expectations).find((e) => e.type === Expectation.Type.FILE_COPY)
		const eScan = Object.values(expectations).find((e) => e.type === Expectation.Type.PACKAGE_SCAN)
		const eDeepScan = Object.values(expectations).find((e) => e.type === Expectation.Type.PACKAGE_DEEP_SCAN)
		const eLoudness = Object.values(expectations).find((e) => e.type === Expectation.Type.PACKAGE_LOUDNESS_SCAN)
		const eThumbnail = Object.values(expectations).find((e) => e.type === Expectation.Type.MEDIA_FILE_THUMBNAIL)
		const ePreview = Object.values(expectations).find((e) => e.type === Expectation.Type.MEDIA_FILE_PREVIEW)

		expect(eCopy).toBeTruthy()
		expect(eScan).toBeTruthy()
		expect(eDeepScan).toBeTruthy()
		expect(eThumbnail).toBeTruthy()
		expect(ePreview).toBeTruthy()
		expect(eLoudness).toBeTruthy()
	})
	test('Duplicated packages', () => {
		const o = setup()

		// The two packages should be combined into one expectation
		const expectedPackages: ExpectedPackageWrap[] = [
			wrap(
				o.packageContainers,
				{
					...copy(o.packages.simpleMedia),
					_id: 'a',
				},
				true
			),
			wrap(
				o.packageContainers,
				{
					...copy(o.packages.simpleMedia),
					_id: 'b',
				},
				true
			),
		]

		const expectations = NRK.api.getExpectations(
			o.logger,
			'test',
			o.packageContainers,
			o.activePlaylist,
			o.activeRundowns,
			expectedPackages,
			o.settings
		)

		expect(Object.keys(expectations)).toHaveLength(6) // copy, scan, deep-scan, thumbnail, preview, loudness

		const eCopy = Object.values(expectations).find((e) => e.type === Expectation.Type.FILE_COPY)
		expect(eCopy).toBeTruthy()
		expect(eCopy?.fromPackages).toHaveLength(2)
	})
	test('Packages priority', () => {
		const o = setup()

		// The two packages should be combined into one expectation
		const expectedPackages: ExpectedPackageWrap[] = [
			wrap(
				o.packageContainers,
				{
					...copy(o.packages.simpleMedia),
					_id: 'a',
				},
				{
					priority: 2,
				}
			),
			wrap(
				o.packageContainers,
				{
					...copy(o.packages.simpleMedia2),
					_id: 'b',
				},
				{
					priority: 1,
				}
			),
		]

		const expectations = NRK.api.getExpectations(
			o.logger,
			'test',
			o.packageContainers,
			o.activePlaylist,
			o.activeRundowns,
			expectedPackages,
			o.settings
		)

		expect(Object.keys(expectations)).toHaveLength(12) // 2x (copy, scan, deep-scan, thumbnail, preview, loudness)

		const sorted = Object.values(expectations).sort((a, b) => {
			// Lowest first: (lower is better)
			if (a.priority > b.priority) return 1
			if (a.priority < b.priority) return -1
			return 0
		})
		expect(sorted.map((exp) => exp.type)).toStrictEqual([
			// Important that these are on top:
			Expectation.Type.FILE_COPY,
			Expectation.Type.FILE_COPY,
			Expectation.Type.PACKAGE_SCAN,
			Expectation.Type.PACKAGE_SCAN,
			// The order of the rest aren't as important:
			Expectation.Type.MEDIA_FILE_THUMBNAIL,
			Expectation.Type.MEDIA_FILE_PREVIEW,
			Expectation.Type.MEDIA_FILE_THUMBNAIL,
			Expectation.Type.PACKAGE_DEEP_SCAN,
			Expectation.Type.MEDIA_FILE_PREVIEW,
			Expectation.Type.PACKAGE_DEEP_SCAN,
			Expectation.Type.PACKAGE_LOUDNESS_SCAN,
			Expectation.Type.PACKAGE_LOUDNESS_SCAN,
		])
	})
})
function setup() {
	const logger = {
		error: jest.fn((...args) => console.log(...args)),
		warn: jest.fn((...args) => console.log(...args)),
		help: jest.fn((...args) => console.log(...args)),
		data: jest.fn((...args) => console.log(...args)),
		info: jest.fn((...args) => console.log(...args)),
		debug: jest.fn((...args) => console.log(...args)),
		prompt: jest.fn((...args) => console.log(...args)),
		http: jest.fn((...args) => console.log(...args)),
		verbose: jest.fn((...args) => console.log(...args)),
		input: jest.fn((...args) => console.log(...args)),
		silly: jest.fn((...args) => console.log(...args)),
	} as any as LoggerInstance
	const managerId = 'mockManager'
	// const packageContainers: PackageContainers,
	const activePlaylist: ActivePlaylist = {
		_id: 'playlist',
		active: true,
		rehearsal: false,
	}
	const activeRundowns: ActiveRundown[] = [
		{
			_id: 'rundown0',
			_rank: 0,
		},
		{
			_id: 'rundown1',
			_rank: 1,
		},
		{
			_id: 'rundown2',
			_rank: 2,
		},
	]
	const settings: PackageManagerSettings = {
		delayRemoval: 0,
		useTemporaryFilePath: false,
	}
	const packageContainers: PackageContainers = {
		source0: {
			label: 'Source 0',
			accessors: {
				local: literal<Accessor.LocalFolder>({
					type: Accessor.AccessType.LOCAL_FOLDER,
					folderPath: 'C:\\source0',
					label: 'Local',
					allowRead: true,
					allowWrite: true,
				}),
			},
		},
		target0: {
			label: 'Target 0',
			accessors: {
				local: literal<Accessor.LocalFolder>({
					type: Accessor.AccessType.LOCAL_FOLDER,
					folderPath: 'C:\\target',
					label: 'Local',
					allowRead: true,
					allowWrite: true,
				}),
			},
		},
		previews: {
			label: 'Target  for Previews',
			accessors: {
				local: literal<Accessor.LocalFolder>({
					type: Accessor.AccessType.LOCAL_FOLDER,
					folderPath: 'C:\\targetPreviews',
					label: 'Local',
					allowRead: true,
					allowWrite: true,
				}),
			},
		},
		thumbnails: {
			label: 'Target for Thumbnails',
			accessors: {
				local: literal<Accessor.LocalFolder>({
					type: Accessor.AccessType.LOCAL_FOLDER,
					folderPath: 'C:\\targetThumbnails',
					label: 'Local',
					allowRead: true,
					allowWrite: true,
				}),
			},
		},
	}
	const packages = {
		simpleMedia: literal<ExpectedPackage.ExpectedPackageMediaFile>({
			_id: 'simpleMedia',
			contentVersionHash: 'hash0',
			layers: ['target0'],
			type: ExpectedPackage.PackageType.MEDIA_FILE,
			content: {
				filePath: 'simpleMedia.mp4',
			},
			version: {},
			sources: [
				{
					containerId: 'source0',
					accessors: {},
				},
			],
			sideEffect: {
				previewContainerId: 'previews',
				previewPackageSettings: {
					path: 'simpleMedia-preview.webm',
				},
				thumbnailContainerId: 'thumbnails',
				thumbnailPackageSettings: {
					path: 'simpleMedia-thumbnail.webm',
				},
				loudnessPackageSettings: {
					channelSpec: ['0+1'],
				},
			},
		}),
		simpleMedia2: literal<ExpectedPackage.ExpectedPackageMediaFile>({
			_id: 'simpleMedia2',
			contentVersionHash: 'hash0',
			layers: ['target0'],
			type: ExpectedPackage.PackageType.MEDIA_FILE,
			content: {
				filePath: 'simpleMedia2.mp4',
			},
			version: {},
			sources: [
				{
					containerId: 'source0',
					accessors: {},
				},
			],
			sideEffect: {
				previewContainerId: 'previews',
				previewPackageSettings: {
					path: 'simpleMedia2-preview.webm',
				},
				thumbnailContainerId: 'thumbnails',
				thumbnailPackageSettings: {
					path: 'simpleMedia2-thumbnail.webm',
				},
				loudnessPackageSettings: {
					channelSpec: ['0+1'],
				},
			},
		}),
	}

	return {
		logger,
		managerId,
		activePlaylist,
		activeRundowns,
		settings,
		packageContainers,
		packages,
	}
}
function wrap(
	packageContainers: PackageContainers,
	expectedPackage: ExpectedPackage.Any,
	externalProps?: boolean | Partial<ExpectedPackageWrap>
): ExpectedPackageWrap {
	let wrapped = wrapExpectedPackage(packageContainers, expectedPackage)
	if (!wrapped) throw new Error('wrapped is undefined')

	if (externalProps) {
		// default:
		wrapped.external = false
		wrapped.playoutDeviceId = 'device0'

		if (typeof externalProps === 'object') {
			wrapped = {
				...wrapped,
				...externalProps,
			}
		}
	}
	return wrapped
}
function copy<T>(o: T): T {
	return JSON.parse(JSON.stringify(o))
}
export {}
