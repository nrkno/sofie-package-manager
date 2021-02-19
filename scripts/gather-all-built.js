const promisify = require("util").promisify
const glob = promisify(require("glob"))
const fse = require('fs-extra');
const mkdirp = require('mkdirp');
const rimraf = promisify(require('rimraf'))

const fseCopy = promisify(fse.copy)

/*
This script gathers all files in the deploy/ folders of the various apps
into a single folder, for convenience
*/

const targetFolder = 'deploy/'

;(async function () {

    await rimraf(targetFolder)
    await mkdirp(targetFolder)

    const deployfolders = await glob(`apps/*/app/deploy`)


    for (const deployfolder of deployfolders) {

        if (deployfolder.match(/boilerplate/)) continue

        console.log(`Copying: ${deployfolder}`)
        await fseCopy(deployfolder, targetFolder)
    }

    console.log(`All files have been copied to: ${targetFolder}`)

})().catch(console.error)
