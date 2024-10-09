/* eslint-disable node/no-unpublished-require */
import { promisify } from 'util'
import { glob } from 'glob'
import fse from 'fs-extra'
import path from 'path'

/*
This script gathers all files in the deploy/ folders of the various apps
into a single folder, for convenience
*/

const targetFolder = 'deploy/'


await fse.mkdirp(targetFolder)
// clear folder:
const files = await fse.readdir(targetFolder)
for (const file of files) {
	if (
		// Only match executables:
		file.match(/.*\.(exe|zip)$/) &&
		// Leave the ffmpeg / ffprobe files:
		!file.match(/ffmpeg|ffprobe/)
	) {
		await fse.unlink(path.join(targetFolder, file))
	}
}

const deployfolders = await glob(`apps/*/app/deploy`)

for (const deployfolder of deployfolders) {
	if (deployfolder.match(/boilerplate/)) continue

	console.log(`Copying: ${deployfolder}`)
	await fse.copy(deployfolder, targetFolder, {
		filter: (src, _dest) =>  {
			const m = (
				// Is executable or zip
				src.endsWith('.exe') ||
				src.endsWith('.zip') ||
				// Is the deploy folder
				src.endsWith('deploy')
			)
			return !!m
		}
	})
}

console.log(`All files have been copied to: ${targetFolder}`)
