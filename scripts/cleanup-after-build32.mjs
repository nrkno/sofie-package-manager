/* eslint-disable node/no-unpublished-import, no-console */

import path from 'path'
import fse from 'fs-extra'
import glob0 from 'glob'
import { promisify } from 'util'

const glob = promisify(glob0)

const basePath = process.cwd()

console.log(`Cleaning up...`)

await fse.rm(path.resolve(path.join(basePath, 'tmp_packages_for_build')), {
	recursive: true,
})

// Remove things that arent used, to reduce file size:
const ps = []
console.log(`Remove unused files...`)
const copiedFiles = [
	...(await glob(`${basePath}/apps/*/app/node_modules/@*/app/*`)),
	...(await glob(`${basePath}/apps/*/app/node_modules/@*/generic/*`)),
]
for (const file of copiedFiles) {
	console.log(`Removing file: "${file}"`)
	ps.push(fse.rm(file, { recursive: true }))
}
await Promise.all(ps)

console.log(`...done!`)
