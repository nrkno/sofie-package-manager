/**
 * This is a small helper to download and extract a set of ffmpeg binaries.
 * It reads the file `./tests/ffmpegReleases.json` to see what versions should be downloaded,
 * and puts them into `.ffmpeg/` at the root of the repository.
 */

import fs from 'fs/promises'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import path from 'path'
import cp from 'child_process'
import fetch from 'node-fetch'

const targetVersions = JSON.parse(await fs.readFile('./tests/ffmpegReleases.json'))

const toPosix = (str) => str.split(path.sep).join(path.posix.sep)

const streamPipeline = promisify(pipeline)

const ffmpegRootDir = './.ffmpeg'
await fs.mkdir(ffmpegRootDir).catch(() => null)

async function pathExists(path) {
	try {
		await fs.stat(path)
		return true
	} catch (e) {
		return false
	}
}

const platformInfo = `${process.platform}-${process.arch}`
const platformVersions = targetVersions[platformInfo]

if (platformVersions) {

	for (const version of platformVersions) {
		const versionPath = path.join(ffmpegRootDir, version.id)
		const dirStat = await pathExists(versionPath)
		if (!dirStat) {
			console.log(`Fetching ${version.url}`)
			// Download it

			const fileExtension = version.url.endsWith('.tar.xz') ? '.tar.xz' : version.url.endsWith('.zip') ? '.zip' : ''
			const tmpPath = path.resolve(path.join(ffmpegRootDir, 'tmp' + fileExtension))

			// eslint-disable-next-line no-undef
			const response = await fetch(version.url)
			if (!response.ok) throw new Error(`unexpected response ${response.statusText}`)
			await streamPipeline(response.body, createWriteStream(tmpPath))

			// Extract it
			if (fileExtension === '.tar.xz') {
				await fs.mkdir(versionPath).catch(() => null)
				cp.execSync(`tar -xJf ${toPosix(tmpPath)} --strip-components=1 -C ${toPosix(versionPath)}`)
			} else if (fileExtension === '.zip') {
				if (process.platform === 'win32') {

					cp.execSync(`tar -xf ${toPosix(tmpPath)}`, {
						cwd: ffmpegRootDir
					})

					const list = cp.execSync(`tar -tf ${toPosix(tmpPath)}`).toString()
					const mainFolder = list.split('\n')[0].trim() // "ffmpeg-4.3.1-win64-static/"
						.replace(/[\/\\]*$/, '') // remove trailing slash
					await fs.rename(path.join(ffmpegRootDir, mainFolder), versionPath)
				} else {
					cp.execSync(`unzip ${toPosix(tmpPath)} -d ${toPosix(ffmpegRootDir)}`)
					const dirname = path.parse(version.url).name
					await fs.rename(path.join(ffmpegRootDir, dirname), versionPath)
				}

				await fs.rm(tmpPath)

			} else {
				throw new Error(`Unhandled file extension: ${version.url}`)
			}
		}
	}
} else {
	throw new Error(`No FFMpeg binaries have been defined for "${platformInfo}" yet`)
}
