import fs from 'fs'
import EventEmitter from 'events'
import { promisify } from 'util'
import path from 'path'

/* eslint-disable no-console */

const fsCopyFile = promisify(fs.copyFile)
const fsMkdir = promisify(fs.mkdir)

const child_process: any = jest.createMockFromModule('child_process')

const mappedDriveLetters: {
	[driveLetter: string]: string // path
} = {}

async function pExec(commandString: string, _options: any): Promise<{ stdout: string; stderr: string }> {
	const NOOP = { stdout: '', stderr: '' }
	if (commandString.match(/^wmic /)) {
		// Change priority of the process
		// Do nothing
		return NOOP
	} else if (commandString.match(/^net use/)) {
		return netUse(commandString)
	} else {
		throw new Error(`Mock child_process.exec: command not implemented: "${commandString}"`)
	}
}
function exec(
	commandString: string,
	options?: any,
	cb?: (error: any | null, result: { stdout: string; stderr: string } | null) => void
): void {
	if (typeof options === 'function' && cb === undefined) {
		cb = options
		options = {}
	}
	pExec(commandString, options)
		.then((result) => cb?.(null, result))
		.catch((err) => cb?.(err, null))
}
child_process.exec = exec
function spawn(command: string, args: string[] = []) {
	const spawned = new SpawnedProcess()
	if (command === 'robocopy') {
		setImmediate(() => {
			robocopy(spawned, args).catch((err) => {
				console.log(err)
				spawned.emit('exit', 9999)
				spawned.emit('close', 9999)
			})
		})
	} else if (command === 'ffmpeg' || command === 'ffmpeg.exe') {
		setImmediate(() => {
			ffmpeg(spawned, args).catch((err) => {
				console.log(err)
				spawned.emit('exit', 9999)
				spawned.emit('close', 9999)
			})
		})
	} else if (command === 'ffprobe' || command === 'ffprobe.exe') {
		setImmediate(() => {
			ffprobe(spawned, args).catch((err) => {
				console.log(err)
				spawned.emit('exit', 9999)
				spawned.emit('close', 9999)
			})
		})
	} else if (command === 'taskkill') {
		// mock killing a task?
	} else {
		throw new Error(`Mock child_process.spawn: command not implemented: "${command}"`)
	}
	return spawned
}
child_process.spawn = spawn

class SpawnedProcess extends EventEmitter {
	public stdout = new EventEmitter()
	public stderr = new EventEmitter()
	public pid: number
	constructor() {
		super()
		this.pid = Date.now()
	}
}
async function robocopy(spawned: SpawnedProcess, args: string[]) {
	let sourceFolder
	let destinationFolder
	const files = []
	for (const arg of args) {
		const options: (string | RegExp)[] = [
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
			if (typeof option === 'string') {
				if (arg === option) {
					isOption = true
					break
				}
			} else {
				if (arg.match(new RegExp(option))) {
					isOption = true
					break
				}
			}
		}
		if (!isOption) {
			if (!sourceFolder) sourceFolder = arg
			else if (!destinationFolder) destinationFolder = arg
			else files.push(arg)
		}
	}

	if (!sourceFolder)
		throw new Error(
			`Mock child_process.spawn: sourceFolder not set: "${args}" (destinationFolder: "${destinationFolder}", files: ${files.join(
				','
			)})`
		)
	if (!destinationFolder)
		throw new Error(
			`Mock child_process.spawn: destinationFolder not set: "${args}" (sourceFolder: "${sourceFolder}", files: ${files.join(
				','
			)}) `
		)
	if (!files.length)
		throw new Error(
			`Mock child_process.spawn: files not set: "${args}" (sourceFolder: "${sourceFolder}", destinationFolder: "${destinationFolder}")`
		)

	// Just do a simple copy, expand this if needed later...
	try {
		for (const file of files) {
			const source = path.join(sourceFolder, file)
			const destination = path.join(destinationFolder, file)

			await fsMkdir(destinationFolder) // robocopy automatically creates the destination folder

			await fsCopyFile(source, destination)
		}
		spawned.emit('exit', 1) // OK
		spawned.emit('close', 1) // OK
	} catch (err) {
		// console.log(err)
		spawned.emit('exit', 16) // Serious error. Robocopy did not copy any files.
		spawned.emit('close', 16) // Serious error. Robocopy did not copy any files.
	}
}
async function ffmpeg(spawned: SpawnedProcess, args: string[]) {
	if (args[0] === '-version') {
		setImmediate(() => {
			spawned.stderr.emit('data', 'version N-102494-g2899fb61d2')
			spawned.emit('exit', 0) // OK
			spawned.emit('close', 0) // note: close allways fires after exit
		})
	} else {
		throw new Error(`Mock child_process.spawn: Unsupported arguments: "${args}"`)
	}
}
async function ffprobe(spawned: SpawnedProcess, args: string[]) {
	if (args[0] === '-version') {
		setImmediate(() => {
			spawned.stderr.emit('data', 'version N-102494-g2899fb61d2')
			spawned.emit('exit', 0) // OK
			spawned.emit('close', 0) // note: close allways fires after exit
		})
	} else {
		throw new Error(`Mock child_process.spawn: Unsupported arguments: "${args}"`)
	}
}

async function netUse(commandString: string): Promise<{ stdout: string; stderr: string }> {
	let stdout = ''
	const stderr = ''

	if (commandString.match(/^net use$/)) {
		stdout += `New connections will be remembered.\r\n`
		stdout += `\r\n`
		stdout += `Status       Local     Remote                    Network\r\n`
		stdout += `-------------------------------------------------------------------------------\r\n`

		for (const [driveLetter, path] of Object.entries<string>(mappedDriveLetters)) {
			stdout += `OK    ${driveLetter}:     ${path} Microsoft Windows Network \r\n`
		}
		stdout += `The command completed successfully.\r\n`

		return { stdout, stderr }
	}
	{
		const m = commandString.match(/^net use (\w): "([^"]+)"(.+)$/) // net use Z: "\\localhost\media" /P:Yes
		if (m) {
			const driveLetter = m[1]
			const path = m[2]
			// const rest = m[3]

			if (mappedDriveLetters[driveLetter]) {
				stdout += 'System error 85 has occurred.\r\n'
				stdout += '\r\n'
				stdout += 'The local device name is already in use.\r\n'
			} else {
				mappedDriveLetters[driveLetter] = path
				stdout += 'The command completed successfully.\r\n'
			}

			return { stdout, stderr }
		}
	}
	{
		const m = commandString.match(/^net use (\w): \/Delete$/) // net use Z: /Delete
		if (m) {
			const driveLetter = m[1]

			if (mappedDriveLetters[driveLetter]) {
				delete mappedDriveLetters[driveLetter]
				stdout += `${driveLetter}: was deleted successfully.\r\n`
			} else {
				stdout += 'The network connection could not be found.\r\n'
				stdout += '\r\n'
				stdout += 'More help is available by typing NET HELPMSG 2250.\r\n'
			}

			return { stdout, stderr }
		}
	}
	// else:
	{
		stdout += 'System error 67 has occurred.\r\n'
		stdout += '\r\n'
		stdout += 'The network name cannot be found.\r\n'

		return { stdout, stderr }
	}
}
module.exports = child_process
