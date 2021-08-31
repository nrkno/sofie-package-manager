/* eslint-disable node/no-unpublished-require, node/no-extraneous-require */

const promisify = require('util').promisify
const cp = require('child_process')
const path = require('path')
// const nexe = require('nexe')
const exec = promisify(cp.exec)
// const spawn = promisify(cp.spawn)
const glob = promisify(require('glob'))

const fse = require('fs-extra');
const mkdirp = require('mkdirp');
const rimraf = promisify(require('rimraf'))

const fseCopy = promisify(fse.copy)

/*
	Runs a command in all lerna packages, one at a time
*/
let commands = process.argv.slice(2)
const lastCommand = commands[commands.length-1]

;(async () => {

	let scopes = []
	if (lastCommand.match(/scope/)) {

		log(`Running command "${commands.join(' ')}" for ${lastCommand}`)

		scopes = [lastCommand]
		commands = commands.slice(0, -1)
	} else {

		log(`Running command "${commands.join(' ')}" in all packages...`)

		// List all Lerna packages:
		const list = await exec('yarn lerna list -a --json')
		const str = list.stdout.replace(/^\$.*$/gm, '').replace(/^Done in.*$/gm, '')

		const packages = JSON.parse(str)

		scopes = packages.map((p) => `--scope=${p.name}`)
	}

	for (const scope of scopes) {
		const cmd = `${commands.join(' ')} ${scope}`
		log(cmd)

		await new Promise((resolve, reject) => {
			const process = cp.exec(cmd, {})
			// const process = cp.spawn(commands[0], [commands.slice(1), `--scope=${package.name}`] )
			process.stdout.on('data', (data) => {
				log((data+'').trimEnd() )
			})
			process.stderr.on('data', (data) => {
				log((data+'').trimEnd() )
			})
			process.on('error', (error) => {
				reject(error)
			})
			process.on('close', (code) => {
				if (code === 0) {
					resolve()
				} else {
					reject('Process exited with code '+code)
				}
			})

		})




	}
	// log(packages)


	log(`...done!`)
})().catch(log)

function log(...args) {
	// eslint-disable-next-line no-console
	console.log(...args)
}
