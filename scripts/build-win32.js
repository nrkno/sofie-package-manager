/* eslint-disable node/no-unpublished-require, node/no-extraneous-require */

const promisify = require('util').promisify
const cp = require('child_process')
const path = require('path')
const { exec: pkg } = require('pkg')
const exec = promisify(cp.exec)
const glob = promisify(require('glob'))

const fse = require('fs-extra')
const mkdirp = require('mkdirp')
const rimraf = promisify(require('rimraf'))

const fseCopy = promisify(fse.copy)

/*
	Due to nexe not taking into account the packages in the mono-repo, we're doing a hack,
	copying the packages into node_modules, so that nexe will include them.
*/
const basePath = process.cwd()
const packageJson = require(path.join(basePath, '/package.json'))
const outputDirectory = path.join(basePath, './deploy/')
const executableName = process.argv[2]
if (!executableName) {
	throw new Error(`Argument for the output executable file name not provided`)
}

;(async () => {
	log(`Collecting dependencies for ${packageJson.name}...`)
	// List all Lerna packages:
	const list = await exec('yarn lerna list -a --json')
	const str = list.stdout.replace(/^\$.*$/gm, '').replace(/^Done in.*$/gm, '')

	const packages = JSON.parse(str)

	await mkdirp(basePath + 'node_modules')

	// Copy the packages into node_modules:
	const copiedFolders = []
	let ps = []
	for (const package0 of packages) {
		if (package0.name.match(/boilerplate/)) continue
		if (package0.name.match(packageJson.name)) continue

		log(`  Copying: ${package0.name}`)

		const source = path.join(`${basePath}/../../../tmp_packages_for_build/`, package0.name)
		const target = path.resolve(path.join(basePath, 'node_modules', package0.name))

		// log(`    ${source} -> ${target}`)
		ps.push(fseCopy(source, target))

		copiedFolders.push(target)
	}

	await Promise.all(ps)
	ps = []

	// Remove things that arent used, to reduce file size:
	log(`Remove unused files...`)
	const copiedFiles = [
		...(await glob(`${basePath}node_modules/@*/app/*`)),
		...(await glob(`${basePath}node_modules/@*/generic/*`)),
	]

	for (const file of copiedFiles) {
		if (
			// Only keep these:
			!file.match(/package0.json$/) &&
			!file.match(/node_modules$/) &&
			!file.match(/dist$/)
		) {
			ps.push(rimraf(file))
		}
	}
	await Promise.all(ps)
	ps = []

	const pkgOutputPath = path.join(outputDirectory, executableName)

	// await nexe.compile({
	// 	input: path.join(basePath, './dist/index.js'),
	// 	output: pkgOutputPath,
	// 	// build: true, //required to use patches
	// 	targets: ['windows-x64-12.18.1'],
	// })

	// Note: This script runs multiple times in parallel
	// pkg has an issue where it fails if multiple processes are downloading its binaries at the same time.
	// therefore, we run it the first script once, then the others in parallel (using a lock file).

	const lockFileFolder = path.join(basePath.replace(/([\\/]apps[\\/]).*/, '$1'), '../')
	const lockFilePath = path.join(lockFileFolder, 'build.lock')

	let firstLockFile = await fse.stat(lockFilePath, 'utf8').catch(() => null)

	if (firstLockFile && firstLockFile.mtimeMs < Date.now() - 1000 * 60) {
		// There is a lock file, but it is OLD!
		log(`There is a lock file, but it is old!`)
		log(`Remove it and run this script again...!`)
		log(`${lockFilePath}`)
		setTimeout(() => {
			// eslint-disable-next-line no-process-exit
			process.exit(1)
		}, 1000 * 60)
		// log(`Lock file is OLD!!!!!!!`)
		// remove it then:
		// await fse.unlink(lockFilePath).catch(() => undefined)
		// firstLockFile = null
	}

	let weAreFirst = undefined
	if (firstLockFile) {
		// There is already a lock file, so we are not the first.
		weAreFirst = false
	} else {
		// The lock file doesn't exist. We're probably first.
		// Create the lock file:
		try {
			await fse.writeFile(lockFilePath, 'locked', {
				flag: 'wx', // Don't allow overWrite
			})
			log(`Set lock file!`)
			// The write succeeded, we're first.
			weAreFirst = true
		} catch (e) {
			// Fail, we weren't first..
			weAreFirst = false
		}
	}

	if (!weAreFirst) {
		log('Waiting for lock file to be released...')
		// We should wait for the unlock-file to be created before continuing.
		let firstIsComplete = false
		while (!firstIsComplete) {
			await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 500))
			try {
				await fse.stat(lockFilePath, 'utf8')
				firstIsComplete = false
			} catch (e) {
				// The lock file has been removed, this means that the first script has finished.
				firstIsComplete = true
			}
		}
	}

	log(`Compiling using pkg...`)

	const TARGET = 'node16-win-x64'

	const options = []

	let pkgError = null
	await pkg([
		path.join(basePath, './dist/index.js'),
		'--target',
		TARGET,
		'--output',
		pkgOutputPath,
		...options,
	]).catch((e) => {
		pkgError = e
	})

	if (weAreFirst) {
		log(`Releasing lock file!`)
		// Removes the lock file, as a signal to other waiting scripts that they can continue:
		await fse.unlink(lockFilePath)
	}
	if (pkgError) throw pkgError

	log(`Cleaning up...`)
	// Clean up after ourselves:
	for (const copiedFolder of copiedFolders) {
		await rimraf(copiedFolder)
	}

	log(`...done!`)
})().catch(log)

function log(...args) {
	// eslint-disable-next-line no-console
	console.log(...args)
}
