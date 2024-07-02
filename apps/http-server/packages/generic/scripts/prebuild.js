const fs = require('fs').promises

async function main() {
	const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'))
	let libStr = await fs.readFile('src/lib.ts', 'utf8')

	libStr = libStr.replace(
		/export const PACKAGE_JSON_VERSION =.*/,
		`export const PACKAGE_JSON_VERSION = '${packageJson.version}'`
	)

	await fs.writeFile('src/lib.ts', libStr, 'utf8')
}

main().catch((e) => {
	// eslint-disable-next-line no-console
	console.error(e)
	// eslint-disable-next-line no-process-exit
	process.exit(1)
})
