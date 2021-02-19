const promisify = require("util").promisify
const cp = require('child_process')
const path = require('path')
const nexe = require('nexe')
const exec = promisify(cp.exec)
const glob = promisify(require("glob"))

const fse = require('fs-extra');
const mkdirp = require('mkdirp');
const rimraf = promisify(require('rimraf'))

const fseCopy = promisify(fse.copy)

const packageJson = require('../package.json')

/*
    Due to nexe not taking into account the packages in the mono-repo, we're doing a hack,
    copying the packages into node_modules, so that nexe will include them.
*/

const outputPath = 'C:\\Users\\johan\\Desktop\\New folder\\'


;(async () => {

    const basePath = './'

    // List all Lerna packages:
    const list = await exec( 'yarn lerna list -a --json')
    const str = list.stdout
        .replace(/^\$.*$/gm, '')
        .replace(/^Done in.*$/gm, '')
    const packages = JSON.parse(str)

    await mkdirp(basePath + 'node_modules')

    // Copy the packages into node_modules:
    const copiedFolders = []
    for (const package of packages) {
        if (package.name.match(/boilerplate/)) continue
        if (package.name.match(packageJson.name)) continue

        console.log(`Copying: ${package.name}`)
        const target = basePath + `node_modules/${package.name}`
        await fseCopy(package.location, target)
        copiedFolders.push(target)
    }

    // Remove things that arent used, to reduce file size:
    const copiedFiles = [
        ...await glob(`${basePath}node_modules/@*/app/*`),
        ...await glob(`${basePath}node_modules/@*/generic/*`),
    ]
    for (const file of copiedFiles) {
        if (
            // Only keep these:
            !file.match(/package.json$/) &&
            !file.match(/node_modules$/) &&
            !file.match(/dist$/)
        ) {
            await rimraf(file)
        }
    }

    await nexe.compile({
        input: './dist/index.js',
        output: outputPath + 'package-manager-single-app.exe',
        // build: true, //required to use patches
        targets: [
            'windows-x64-12.18.1'
        ],
    })

    // Clean after ourselves:
    for (const copiedFolder of copiedFolders) {
        await rimraf(copiedFolder)
    }

    // const basePath = 'C:\\Users/johan/Desktop/New folder/'
    // await nexe.compile({
    //     input: './dist/index.js',
    //     output: basePath + 'package-manager-single-app.exe',
    //     // build: true, //required to use patches
    //     targets: [
    //         'windows-x64-12.18.1'
    //     ],
    // })

    // // Copy node_modules:
    // const list = await exec( 'yarn lerna list -a --json')
    // const str = list.stdout
    //     // .replace(/.*(\[.*)\nDone in.*/gs, '$1')
    //     .replace(/^\$.*$/gm, '')
    //     .replace(/^Done in.*$/gm, '')
    // // console.log('str', str)
    // const packages = JSON.parse(str)

    // await mkdirp(basePath + 'node_modules')


    // for (const package of packages) {
    //     if (package.name.match(/boilerplate/)) continue

    //     console.log(`Copying: ${package.name}`)
    //     await fseCopy(package.location, basePath + `node_modules/${package.name}`)
    // }

    // // remove things that arent used:
    // const copiedFiles = [
    //     ...await glob(`${basePath}node_modules/@*/app/*`),
    //     ...await glob(`${basePath}node_modules/@*/generic/*`),
    // ]
    // console.log(copiedFiles)
    // for (const file of copiedFiles) {
    //     if (
    //         file.match(/package.json$/) ||
    //         file.match(/node_modules$/) ||
    //         file.match(/dist$/)
    //     ) {
    //         // keep it
    //     } else {
    //         await rimraf(file)
    //     }
    // }





})().catch(console.error)

