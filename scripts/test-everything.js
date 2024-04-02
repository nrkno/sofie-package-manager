/* eslint-disable node/no-unpublished-require, no-console */

const { promisify } = require('util')
const { exec } = require('child_process')

const execPromise = promisify(exec)

/*
This script test _everything_ like building, testing, building binaries, building docker images, etc.
Run this script when updating larger things, like the node version, yarn version etc.
*/

;(async function () {
	await run('yarn')
	await run('yarn build')
	await run('yarn test')

	// Test that binary builds work:
	await run('yarn do:build-win32:ci')

	// Test that docker builds work:
	await run('docker build -f apps/http-server/app/Dockerfile -t pm-http-server .')
	await run(
		'docker build -f apps/quantel-http-transformer-proxy/app/Dockerfile -t pm-quantel-http-transformer-proxy .'
	)

	// Done
	console.log('All seems to be working!')
})().catch(console.error)

async function run(command) {
	console.log(`RUN COMMAND: ${command}`)
	const pChild = execPromise(command)

	pChild.child.stdout.on('data', console.log)
	pChild.child.stderr.on('data', console.log)

	await pChild
}
