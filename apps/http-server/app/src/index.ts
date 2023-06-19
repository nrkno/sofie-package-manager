import { startProcess } from '@http-server/generic'
import { readFileSync } from 'fs'
import { join as pathJoin } from 'path'
/* eslint-disable no-console */

const packageInfo = JSON.parse(readFileSync(pathJoin(__dirname, './../package.json')).toString('utf-8'))

console.log('process started') // This is a message all Sofie processes log upon startup
console.log(`version: ${packageInfo.version}`)
startProcess().catch(console.error)
