import { startProcess } from '@appcontainer-node/generic'
/* eslint-disable no-console */

console.log('process started') // This is a message all Sofie processes log upon startup
startProcess().catch(console.error)
