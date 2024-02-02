import path from 'path'
import { LocalFolderAccessorHandle } from '../worker/accessorHandlers/localFolder'
import { setFFMpegExecutables, spawnFFMpeg } from '../worker/workers/windowsWorker/expectationHandlers/lib/ffmpeg'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const targetVersions = require('../../../../../tests/ffmpegReleases.json')

export const SamplesDir = path.join(__dirname, '../../../../../tests/samples')

export async function callSpawnFFmpeg(args: string[], targetHandle: LocalFolderAccessorHandle<any>): Promise<void> {
	let resolve = () => {}
	let reject = (_err: Error) => {}
	const result = new Promise<void>((resolve2, reject2) => {
		resolve = resolve2
		reject = reject2
	})

	const ffmpegProcess = await spawnFFMpeg(
		args,
		targetHandle,
		async () => resolve(),
		async (err) => reject(err)
	)
	expect(ffmpegProcess).toBeTruthy()

	// Wait for process to complete
	await result
}

export function runForEachFFMpegRelease(runForFFmpegRelease: () => void) {
	const ffprobeFilename = process.platform === 'win32' ? 'bin/ffprobe.exe' : 'ffprobe'
	const ffmpegFilename = process.platform === 'win32' ? 'bin/ffmpeg.exe' : 'ffmpeg'

	const ffmpegRootPath = path.join(__dirname, '../../../../../.ffmpeg')
	for (const version of targetVersions[`${process.platform}-${process.arch}`]) {
		describe(`FFmpeg ${version.id}`, () => {
			beforeEach(() => {
				setFFMpegExecutables({
					ffmpeg: path.join(ffmpegRootPath, version.id, ffmpegFilename),
					ffprobe: path.join(ffmpegRootPath, version.id, ffprobeFilename),
				})
			})
			afterAll(() => {
				setFFMpegExecutables(null)
			})

			runForFFmpegRelease()
		})
	}
}
