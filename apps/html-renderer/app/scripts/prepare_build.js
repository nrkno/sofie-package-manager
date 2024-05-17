const fs = require('fs')
const path = require('path')
/* eslint-disable no-console */

/*
 * This script copies some dependencies from the main node_modules folder to the node_modules folder of this project.
 * So that electron-builder includes them when building the executable.

*/

async function main() {
	// Things to copy:

	const baseDir = path.resolve('../../..')
	const myDir = path.resolve('.')

	const libsToCopy = ['tslib', '@sofie-automation']

	// Create node_modules folder
	await fs.promises.mkdir(path.join(myDir, 'node_modules'), { recursive: true })

	for (const lib of libsToCopy) {
		const src = path.join(baseDir, `node_modules/${lib}`)
		const target = path.join(myDir, `node_modules/${lib}`)
		console.log(`Copying ${src} to ${target}`)
		await fs.promises.cp(src, target, {
			recursive: true,
		})
	}
}

main().catch(console.error)
