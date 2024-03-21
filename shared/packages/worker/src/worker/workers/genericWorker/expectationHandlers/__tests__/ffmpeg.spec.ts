import { tmpdir } from 'os'
import path from 'path'
import { stat as fsStat, unlink as fsUnlink } from 'fs/promises'
import { LocalFolderAccessorHandle } from '../../../../accessorHandlers/localFolder'
import {
	FFProbeScanResult,
	scanFieldOrder,
	scanLoudness,
	scanMoreInfo,
	ScanMoreInfoResult,
	scanWithFFProbe,
} from '../lib/scan'
import { mock } from 'jest-mock-extended'
import { Expectation, literal, LoggerInstance } from '@sofie-package-manager/api'
import { LoudnessScanResult } from '../lib/coreApi'
import { previewFFMpegArguments, thumbnailFFMpegArguments } from '../lib'
import { callSpawnFFmpeg, runForEachFFMpegRelease, SamplesDir } from '../../../../../__tests__/ffmpegHelper'

function createLocalFolderAccessorHandleMock(fullPath: string): LocalFolderAccessorHandle<any> {
	return mock<LocalFolderAccessorHandle<any>>(
		{
			type: LocalFolderAccessorHandle.type,
			fullPath: fullPath,
			filePath: path.basename(fullPath),
		},
		{
			fallbackMockImplementation: () => {
				throw new Error('Not mocked')
			},
		}
	)
}

runForEachFFMpegRelease(() => {
	describe('name with spaces.mov', () => {
		const clipPath = path.join(SamplesDir, 'name with spaces.mov')
		const fileHandleMock = createLocalFolderAccessorHandleMock(clipPath)

		it('ffprobe scan', async () => {
			const probeResult = await scanWithFFProbe(fileHandleMock)
			expect(probeResult).toMatchObject(
				literal<FFProbeScanResult>({
					filePath: expect.anything(),
					format: {
						duration: '2.000000',
					},
					streams: [
						{
							index: 0,
							codec_type: 'video',
						},
						{
							index: 1,
							codec_type: 'audio',
						},
						{
							index: 2,
							codec_type: 'data',
						},
					],
				})
			)
		})

		it('field order', async () => {
			const targetVersion: Expectation.PackageDeepScan['endRequirement']['version'] = {
				fieldOrder: true,
			}

			const fieldOrder = await scanFieldOrder(fileHandleMock, targetVersion)
			expect(fieldOrder).toBe('progressive')
		})

		it('field order: disabled', async () => {
			const targetVersion: Expectation.PackageDeepScan['endRequirement']['version'] = {
				fieldOrder: false,
			}

			const fieldOrder = await scanFieldOrder(fileHandleMock, targetVersion)
			expect(fieldOrder).toBe('unknown')
		})

		it('loudness', async () => {
			const targetVersion: Expectation.PackageLoudnessScan['endRequirement']['version'] = {
				channels: ['0'],
				inPhaseDifference: true,
				balanceDifference: true,
			}

			const fakeFFProbeScanResult = null as any as FFProbeScanResult // This is not used
			const onProgress = jest.fn()

			const loudness = await scanLoudness(fileHandleMock, fakeFFProbeScanResult, targetVersion, onProgress)
			expect(loudness).toEqual(
				literal<LoudnessScanResult>({
					channels: {
						'0': {
							success: true,
							balanceDifference: -0.6999999999999993,
							inPhaseDifference: -0.8000000000000007,
							integrated: -15,
							integratedThreshold: -25,
							layout: 'stereo',
							range: 0,
							rangeHigh: 0,
							rangeLow: 0,
							rangeThreshold: 0,
							truePeak: -13.6,
						},
					},
				})
			)

			expect(onProgress).toHaveBeenCalled()
		})

		it('scan more', async () => {
			const onProgress = jest.fn()

			const targetVersion: Expectation.PackageDeepScan['endRequirement']['version'] = {
				scenes: true,
				freezeDetection: true,
				blackDetection: true,
			}

			const logger = mock<LoggerInstance>()

			const probeResult = await scanWithFFProbe(fileHandleMock)
			const scanInfo = await scanMoreInfo(fileHandleMock, probeResult, targetVersion, onProgress, logger)

			expect(scanInfo).toEqual(
				literal<ScanMoreInfoResult>({
					scenes: [],
					freezes: [],
					blacks: [],
				})
			)

			// expect(onProgress).toHaveBeenCalled()
		})

		it('generate thumbnail', async () => {
			const outputPath = path.join(tmpdir(), Date.now() + '.jpg')

			try {
				const metadata = {
					version: {
						width: 160,
						height: 90,
					},
				}
				const args = thumbnailFFMpegArguments(clipPath, metadata, undefined, true)

				const targetHandle = createLocalFolderAccessorHandleMock(outputPath)

				await callSpawnFFmpeg(args, targetHandle)

				const fileStat = await fsStat(outputPath)
				expect(fileStat.isFile()).toBeTruthy()
			} finally {
				await fsUnlink(outputPath).catch(() => null)
			}
		})

		it('generate preview', async () => {
			const outputPath = path.join(tmpdir(), Date.now() + '.jpg')

			try {
				const metadata = {
					version: {
						bitrate: '50k',
						height: 160,
						width: 90,
					},
				}
				const args = previewFFMpegArguments(clipPath, false, metadata)

				const targetHandle = createLocalFolderAccessorHandleMock(outputPath)

				await callSpawnFFmpeg(args, targetHandle)

				const fileStat = await fsStat(outputPath)
				expect(fileStat.isFile()).toBeTruthy()
			} finally {
				await fsUnlink(outputPath).catch(() => null)
			}
		})
	})
})
