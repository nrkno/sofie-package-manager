const promisify = require("util").promisify
const globOrg = require("glob")
const deepExtend = require('deep-extend');
const fs = require('fs')
const path = require('path')

const glob = promisify(globOrg)
const fsReadFile = promisify(fs.readFile)
const fsWriteFile = promisify(fs.writeFile)

const rootPackage = require('../package.json')

/*
This script copies some common properties (from commonPackage.json)
into package.json of each of the packages.
*/


;(async function () {

    let count = 0
    const extendPackageStr = await fsReadFile("commonPackage.json")
    const extendPackage = JSON.parse(extendPackageStr)
    delete extendPackage.description // don't copy this propery

    for (const workspaceDef of rootPackage.workspaces) {

        const packageJsons = await glob(`${workspaceDef}/package.json`)
        for (const packageJsonPath of packageJsons) {
            try {
                if (!packageJsonPath.match(/node_modules/)) {

                    const packageJsonStr = await fsReadFile(packageJsonPath)
                    const packageJson = JSON.parse(packageJsonStr)

                    deepExtend(packageJson, extendPackage)

                    await fsWriteFile(packageJsonPath, JSON.stringify(packageJson, undefined, 4))
                    count++
                }
            } catch (err) {
                console.error(`Error when processing ${packageJsonPath}`)
                throw err
            }
        }
    }

    console.log(`Updated package.json of ${count} packages`)
})().catch(console.error)
