import { startProcess } from '@http-server/generic'
import fs from 'fs'
import path from 'path'
/* eslint-disable no-console */

const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, './../package.json')).toString('utf-8'))

console.log('process started') // This is a message all Sofie processes log upon startup
console.log(`version: ${packageInfo.version}`)
startProcess().catch(console.error)
