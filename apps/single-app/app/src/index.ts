import { startSingleApp } from './singleApp'
import { readFileSync } from 'fs'
import { join as pathJoin } from 'path'

const packageInfo = JSON.parse(readFileSync(pathJoin(__dirname, './../package.json')).toString('utf-8'))

// eslint-disable-next-line no-console
console.log('process started') // This is a message all Sofie processes log upon startup
// eslint-disable-next-line no-console
console.log(`version: ${packageInfo.version}`)
// eslint-disable-next-line no-console
startSingleApp().catch(console.error)
