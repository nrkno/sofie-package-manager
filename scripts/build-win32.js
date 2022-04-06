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

	log(`Compiling using pkg...`)

	const pkgOutputPath = path.join(outputDirectory, executableName)

	console.log('pkgOutputPath', pkgOutputPath)

	// await nexe.compile({
	// 	input: path.join(basePath, './dist/index.js'),
	// 	output: pkgOutputPath,
	// 	// build: true, //required to use patches
	// 	targets: ['windows-x64-12.18.1'],
	// })

	const TARGET = 'node16-win-x64'

	const options = []

	await pkg([path.join(basePath, './dist/index.js'), '--target', TARGET, '--output', pkgOutputPath, ...options])

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
