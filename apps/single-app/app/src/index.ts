import { startSingleApp } from './singleApp'

// eslint-disable-next-line no-console
console.log('process started') // This is a message all Sofie processes log upon startup

startSingleApp().catch(console.log)
