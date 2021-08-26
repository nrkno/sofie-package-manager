import fs from 'fs'
import EventEmitter from 'events'
import { promisify } from 'util'
import path from 'path'

/* eslint-disable no-console */

const fsCopyFile = promisify(fs.copyFile)
const fsMkdir = promisify(fs.mkdir)

const child_process: any = jest.createMockFromModule('child_process')

function exec(commandString: string) {
	if (commandString.match(/^wmic /)) {
		// Change priority of the process
		// Do nothing
	} else {
		throw new Error(`Mock child_process.exec: command not implemented: "${commandString}"`)
	}
}
child_process.exec = exec
function spawn(command: string, args: string[] = []) {
	const spawned = new SpawnedProcess()
	if (command === 'robocopy') {
		setImmediate(() => {
			robocopy(spawned, args).catch((err) => {
				console.log(err)
				spawned.emit('close', 9999)
			})
		})
	} else if (command === 'ffmpeg' || command === 'ffmpeg.exe') {
		setImmediate(() => {
			ffmpeg(spawned, args).catch((err) => {
				console.log(err)
				spawned.emit('close', 9999)
			})
		})
	} else if (command === 'ffprobe' || command === 'ffprobe.exe') {
		setImmediate(() => {
			ffprobe(spawned, args).catch((err) => {
				console.log(err)
				spawned.emit('close', 9999)
			})
		})
	} else {
		throw new Error(`Mock child_process.spawn: command not implemented: "${command}"`)
	}
	return spawned
}
child_process.spawn = spawn

class SpawnedProcess extends EventEmitter {
	public stdout = new EventEmitter()
	public stderr = new EventEmitter()
}
async function robocopy(spawned: SpawnedProcess, args: string[]) {
	let sourceFolder
	let destinationFolder
	const files = []
	for (const arg of args) {
		const options = [
			'/s',
			'/e',
			'/lev:',
			'/z',
			'/b',
			'/zb',
			'/j',
			'/efsraw',
			'/copy:',
			'/dcopy:',
			'/sec',
			'/copyall',
			'/nocopy',
			'/secfix',
			'/timfix',
			'/purge',
			'/mir',
			'/mov',
			'/move',
			'/a+:',
			'/a-:',
			'/create',
			'/fat',
			'/256',
			'/mon:',
			'/mot:',
			'/MT',
			'/rh:hhmm-hhmm',
			'/pf',
			'/ipg:n',
			'/sl',
			'/nodcopy',
			'/nooffload',
			'/compress',
			'/njh',
			'/njs',
			'/bytes',
		]

		let isOption = false
		for (const option of options) {
			if (arg.match(new RegExp(option))) {
				isOption = true
				break
			}
		}
		if (!isOption) {
			if (!sourceFolder) sourceFolder = arg
			else if (!destinationFolder) destinationFolder = arg
			else files.push(arg)
		}
	}

	if (!sourceFolder) throw new Error(`Mock child_process.spawn: sourceFolder not set: "${args}"`)
	if (!destinationFolder) throw new Error(`Mock child_process.spawn: destinationFolder not set: "${args}"`)
	if (!files.length) throw new Error(`Mock child_process.spawn: files not set: "${args}"`)

	// Just do a simple copy, expand this if needed later...
	try {
		for (const file of files) {
			const source = path.join(sourceFolder, file)
			const destination = path.join(destinationFolder, file)

			await fsMkdir(destinationFolder) // robocopy automatically creates the destination folder

			await fsCopyFile(source, destination)
		}
		spawned.emit('close', 1) // OK
	} catch (err) {
		// console.log(err)
		spawned.emit('close', 16) // Serious error. Robocopy did not copy any files.
	}
}
async function ffmpeg(spawned: SpawnedProcess, args: string[]) {
	if (args[0] === '-version') {
		spawned.stderr.emit('data', 'version N-102494-g2899fb61d2')
		spawned.emit('close', 0) // OK
	} else {
		throw new Error(`Mock child_process.spawn: Unsupported arguments: "${args}"`)
	}
}
async function ffprobe(spawned: SpawnedProcess, args: string[]) {
	if (args[0] === '-version') {
		spawned.stderr.emit('data', 'version N-102494-g2899fb61d2')
		spawned.emit('close', 0) // OK
	} else {
		throw new Error(`Mock child_process.spawn: Unsupported arguments: "${args}"`)
	}
}

module.exports = child_process
