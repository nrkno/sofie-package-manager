/* eslint-disable no-console, node/no-unpublished-require */
const fs = require('fs')
const path = require('path')
const archiver = require('archiver')

/*
 * This script gathers the built files from electron-builder and zips them into a zip file
 */

async function main() {
	const myDir = path.resolve('.')
	const deployDir = path.join(myDir, 'deploy')
	const archiveDir = path.join(deployDir, 'win-unpacked')

	const zipFile = path.join(deployDir, 'html-renderer.zip')

	await new Promise((resolve, reject) => {
		const output = fs.createWriteStream(zipFile)
		const archive = archiver('zip', {
			zlib: { level: 5 }, // Sets the compression level.
		})
		output.on('close', function () {
			console.log(archive.pointer() + ' total bytes')
			resolve()
		})
		archive.on('warning', function (err) {
			if (err.code === 'ENOENT') console.log(`WARNING: ${err}`)
			else reject(err)
		})
		archive.on('error', reject)
		archive.pipe(output)

		console.log(`Archiving ${archiveDir}`)
		archive.directory(archiveDir, false)

		archive.finalize()
	})
	console.log('Zipping done, removing temporary artifacts...')

	// Remove the archived directory
	await fs.promises.rm(archiveDir, { recursive: true })
	await fs.promises.rm(path.join(deployDir, 'html-renderer.exe'), { recursive: true })
	await fs.promises.rm(path.join(myDir, 'node_modules'), { recursive: true })
}

main().catch(console.error)
