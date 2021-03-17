import * as fs from 'fs'
import * as EventEmitter from 'events'
import { promisify } from 'util'
import * as path from 'path'

const fsCopyFile = promisify(fs.copyFile)
// @ts-expect-error mock
const fs__mockSetDirectory = fs.__mockSetDirectory

const child_process = jest.createMockFromModule('child_process') as any

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

			fs__mockSetDirectory(destinationFolder) // robocopy automatically creates the destination folder

			await fsCopyFile(source, destination)
		}
		spawned.emit('close', 1) // OK
	} catch (err) {
		console.log(err)
		spawned.emit('close', 9999)
	}
}

module.exports = child_process
