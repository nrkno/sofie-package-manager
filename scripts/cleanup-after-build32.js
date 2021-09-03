/* eslint-disable node/no-unpublished-require, node/no-extraneous-require */

const promisify = require('util').promisify
const path = require('path')

const rimraf = promisify(require('rimraf'))

const basePath = process.cwd()


;(async () => {

	log(`Cleaning up...`)

	await rimraf(path.resolve(path.join(basePath, 'tmp_packages_for_build')))

	log(`...done!`)
})().catch(log)

function log(...args) {
	// eslint-disable-next-line no-console
	console.log(...args)
}
