import { startSingleApp } from './singleApp'
import fs from 'fs'
import path from 'path'

const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, './../package.json')).toString('utf-8'))

// eslint-disable-next-line no-console
console.log('process started') // This is a message all Sofie processes log upon startup
// eslint-disable-next-line no-console
console.log(`version: ${packageInfo.version}`)
// eslint-disable-next-line no-console
startSingleApp().catch(console.error)
