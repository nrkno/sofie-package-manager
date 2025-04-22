import path from 'path'
import { copyFile, mkdtemp, readdir } from 'fs/promises'
import { runForEachFFMpegRelease, SamplesDir } from '../../../__tests__/ffmpegHelper'
import { rimraf } from 'rimraf'
import { convertAudio, countFrames, createTGASequence, getStreamIndices } from '../atem'
import { tmpdir } from 'os'

async function copyToTmpDir(inputFile: string): Promise<{ tmpDir: string; copiedFile: string }> {
	const tmpDir = await mkdtemp(path.join(tmpdir(), 'package-manager-atem-'))
	const copiedFile = path.join(tmpDir, 'input_file')
	await copyFile(inputFile, copiedFile)

	return { tmpDir, copiedFile }
}

runForEachFFMpegRelease(() => {
	describe('name with spaces.mov', () => {
		const clipPath = path.join(SamplesDir, 'name with spaces.mov')

		let tmpDir: string
		let copiedFile: string

		beforeEach(async () => {
			const res = await copyToTmpDir(clipPath)
			tmpDir = res.tmpDir
			copiedFile = res.copiedFile

			const dirListBefore = await readdir(tmpDir)
			expect(dirListBefore).toHaveLength(1)
		})

		afterEach(async () => {
			rimraf.sync(tmpDir)
		})

		it('createTGASequence', async () => {
			const result = await createTGASequence(copiedFile)
			expect(result).toBe('')

			const dirListAfter = await readdir(tmpDir)
			expect(dirListAfter).toHaveLength(51)
		})

		// TODO: convertFrameToRGBA

		it('convertAudio', async () => {
			const result = await convertAudio(copiedFile)
			expect(result).toBe('')

			const dirListAfter = await readdir(tmpDir)
			expect(dirListAfter).toHaveLength(2)
		})

		it('countFrames', async () => {
			const result = await countFrames(copiedFile)
			expect(result).toBe(50)
		})

		it('getStreamIndicies', async () => {
			const videoResult = await getStreamIndices(copiedFile, 'video')
			expect(videoResult).toEqual([0])

			const audioResult = await getStreamIndices(copiedFile, 'audio')
			expect(audioResult).toEqual([1])
		})
	})
})
