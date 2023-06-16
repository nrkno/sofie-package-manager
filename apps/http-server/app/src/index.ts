import { startProcess } from '@http-server/generic'
/* eslint-disable no-console */

import packageInfo from './../package.json'

console.log('process started') // This is a message all Sofie processes log upon startup
console.log(`version: ${packageInfo.version}`)
startProcess().catch(console.error)
