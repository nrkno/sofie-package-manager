import EventEmitter from 'events'

/* eslint-disable no-console */

const child_process: any = jest.createMockFromModule('child_process')

async function pExec(_commandString: string, _options: any): Promise<{ stdout: string; stderr: string }> {
	const NOOP = { stdout: '', stderr: '' }
	return NOOP
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

const allProcesses: SpawnedProcess[] = []
let mockOnNewProcessClb: null | ((process: SpawnedProcess) => void) = null
function spawn(command: string, args: string[] = []) {
	const spawned = new SpawnedProcess(command, args)
	mockOnNewProcessClb?.(spawned)
	allProcesses.push(spawned)

	spawned.on('exit', () => {
		const index = allProcesses.indexOf(spawned)
		allProcesses.splice(index, 1)
	})
	return spawned
}
child_process.spawn = spawn

function mockOnNewProcess(clb: (process: SpawnedProcess) => void) {
	mockOnNewProcessClb = clb
}
child_process.mockOnNewProcess = mockOnNewProcess

function mockListAllProcesses(): SpawnedProcess[] {
	return allProcesses
}
child_process.mockListAllProcesses = mockListAllProcesses

function mockClearAllProcesses(): void {
	allProcesses.length = 0
}
child_process.mockClearAllProcesses = mockClearAllProcesses

class SpawnedProcess extends EventEmitter {
	public stdout = new EventEmitter()
	public stderr = new EventEmitter()
	public pid: number

	constructor(public command: string, public args: string[]) {
		super()
		this.pid = Date.now()
	}

	kill() {
		this.emit('exit')
		this.stdout.emit('end')
		this.stderr.emit('end')
		return true
	}
}

module.exports = child_process
