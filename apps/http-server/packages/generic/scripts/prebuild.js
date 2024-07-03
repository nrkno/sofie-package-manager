const fs = require('fs').promises

async function main() {
	const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'))
	const libStr = `// ****** This file is generated at build-time by scripts/prebuild.js ******
/**
 * The version of the package.json file
 */
export const PACKAGE_JSON_VERSION = '${packageJson.version}'
`

	await fs.writeFile('src/packageVersion.ts', libStr, 'utf8')
}

main().catch((e) => {
	// eslint-disable-next-line no-console
	console.error(e)
	// eslint-disable-next-line no-process-exit
	process.exit(1)
})
