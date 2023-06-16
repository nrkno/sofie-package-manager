import { startSingleApp } from './singleApp'

import packageInfo from './../package.json'

// eslint-disable-next-line no-console
console.log('process started') // This is a message all Sofie processes log upon startup
// eslint-disable-next-line no-console
console.log(`version: ${packageInfo.version}`)
// eslint-disable-next-line no-console
startSingleApp().catch(console.error)
