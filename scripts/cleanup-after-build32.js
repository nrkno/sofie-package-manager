/* eslint-disable node/no-unpublished-require, node/no-extraneous-require */

const promisify = require('util').promisify
const path = require('path')
const glob = promisify(require('glob'))

const rimraf = promisify(require('rimraf'))

const basePath = process.cwd()

;(async () => {
	log(`Cleaning up...`)

	await rimraf(path.resolve(path.join(basePath, 'tmp_packages_for_build')))

	// Remove things that arent used, to reduce file size:
	const ps = []
	log(`Remove unused files...`)
	const copiedFiles = [
		...(await glob(`${basePath}/apps/*/app/node_modules/@*/app/*`)),
		...(await glob(`${basePath}/apps/*/app/node_modules/@*/generic/*`)),
	]
	for (const file of copiedFiles) {
		log(`Removing file: "${file}"`)
		ps.push(rimraf(file))
	}
	await Promise.all(ps)

	log(`...done!`)
})().catch(log)

function log(...args) {
	// eslint-disable-next-line no-console
	console.log(...args)
}
