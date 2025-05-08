// eslint-disable-next-line node/no-unpublished-import
import wndMock0 from 'windows-network-drive' // Note: this is a mocked module
import { EventEmitter } from 'events' // Note: this is a mocked module
import { Readable, Writable } from 'stream'
import { promisify } from 'util'
// import * as Path from 'path'

import type { WNDMockType } from './windows-network-drive'

const wndMock = wndMock0 as any as WNDMockType

const DEBUG_LOG = false
function debugLog(...args: any[]): void {
	// eslint-disable-next-line no-console
	if (DEBUG_LOG) console.log(...args)
}

const fs: any = jest.createMockFromModule('fs')

type MockAny = MockDirectory | MockFile
interface MockBase {
	isDirectory: boolean
	accessRead: boolean
	accessWrite: boolean
}
interface MockDirectory extends MockBase {
	isDirectory: true
	content: { [fileName: string]: MockAny }
}
interface MockFile extends MockBase {
	isDirectory: false
	size: number
	content: any
}

const mockRoot: MockDirectory = {
	accessRead: true,
	accessWrite: true,
	isDirectory: true,
	content: {},
}
const openFileDescriptors: { [fd: string]: MockAny } = {}
let fdId = 0
const fsMockEmitter = new EventEmitter()

function getMock(path: string, orgPath?: string, dir?: MockDirectory): MockAny {
	path = path.replace(/\/\//g, '/') // remove double slashes

	dir = dir || mockRoot
	orgPath = orgPath || path

	const m = path.match(/([^/]+)\/(.*)/)
	if (m) {
		const dirName = m[1]
		const nextPath = m[2]

		const nextDir = dir.content[dirName]
		if (nextPath === '') return nextDir

		if (nextDir) {
			if (nextDir.isDirectory) {
				return getMock(nextPath, orgPath, nextDir)
			} else {
				throw Object.assign(new Error(`ENOTDIR: getMock: not a directory ${orgPath}`), {
					errno: -4058,
					code: 'ENOTDIR',
					syscall: 'mock',
					path: path,
				})
			}
		}
	} else {
		const fileName = path
		const file = dir.content[fileName]
		if (file) {
			return file
		}
	}
	throw Object.assign(new Error(`ENOENT: getMock: no such file or directory ${orgPath}`), {
		errno: -4058,
		code: 'ENOENT',
		syscall: 'mock',

		path: path,
	})
}
function setMock(path: string, create: MockAny, autoCreateTree: boolean, force = false, dir?: MockDirectory): void {
	dir = dir || mockRoot

	const m = path.match(/([^/]+)\/(.*)/)
	if (m) {
		const dirName = m[1]
		const nextPath = m[2]

		if (!dir.content[dirName]) {
			if (autoCreateTree) {
				dir.content[dirName] = {
					accessRead: true,
					accessWrite: true,
					isDirectory: true,
					content: {},
				}
			} else {
				throw Object.assign(new Error(`ENOENT: setMock: no such file or directory ${path}`), {
					errno: -4058,
					code: 'ENOENT',
					syscall: 'mock',
					path: path,
				})
			}
		}
		const nextDir = dir.content[dirName]
		if (!nextDir.accessWrite) {
			throw Object.assign(new Error(`EACCESS: setMock: Not able to write ${path}`), {
				errno: 0,
				code: 'EACCESS',
				syscall: 'mock',
				path: path,
			})
		}
		if (!nextDir.isDirectory) {
			throw Object.assign(new Error(`ENOTDIR: setMock: not a directory ${path}`), {
				errno: -4058,
				code: 'ENOTDIR',
				syscall: 'mock',
				path: path,
			})
		}

		if (nextDir) {
			return setMock(nextPath, create, autoCreateTree, force, nextDir)
		}
	} else {
		const fileName = path
		if (dir.content[fileName]) {
			if (!dir.content[fileName].accessWrite && !force) {
				throw Object.assign(new Error(`EACCESS: Not able to write to parent folder "${path}"`), {
					errno: 0,
					code: 'EACCESS',
					syscall: 'mock',
					path: path,
				})
			}
		}
		dir.content[fileName] = create

		debugLog('setMock', path, create)
	}
}
function deleteMock(path: string, orgPath?: string, dir?: MockDirectory): void {
	dir = dir || mockRoot
	orgPath = orgPath || path

	const m = path.match(/([^/]+)\/(.*)/)
	if (m) {
		const dirName = m[1]
		const nextPath = m[2]

		if (!dir.content[dirName]) {
			dir.content[dirName] = {
				accessRead: true,
				accessWrite: true,
				isDirectory: true,
				content: {},
			}
		}
		const nextDir = dir.content[dirName]
		if (!nextDir.accessWrite) {
			throw Object.assign(new Error(`EACCESS: Not able to write ${orgPath}`), {
				errno: 0,
				code: 'EACCESS',
				syscall: 'mock',
				path: path,
			})
		}
		if (!nextDir.isDirectory) {
			throw Object.assign(new Error(`ENOTDIR: not a directory ${orgPath}`), {
				errno: -4058,
				code: 'ENOTDIR',
				syscall: 'mock',
				path: path,
			})
		}

		if (nextDir) {
			return deleteMock(nextPath, orgPath, nextDir)
		}
	} else {
		const fileName = path
		delete dir.content[fileName]
	}
}
function existsMock(path: string): boolean {
	try {
		getMock(path)
		return true
	} catch (err) {
		if ((err as any).code === 'ENOENT') return false
		throw err
	}
}
export function __printAllFiles(): string {
	const getPaths = (dir: MockDirectory, indent: string): string => {
		const strings: any[] = []
		for (const [name, file] of Object.entries<MockAny>(dir.content)) {
			if (file.isDirectory) {
				strings.push(`${indent}${name}/`)
				strings.push(getPaths(file, indent + '  '))
			} else {
				strings.push(
					`${indent}${name}: size: ${file.size} (${file.accessRead ? 'read' : ''} ${
						file.accessWrite ? 'write' : ''
					})`
				)
			}
		}
		return strings.join('\n')
	}
	return getPaths(mockRoot, '')
}
fs.__printAllFiles = __printAllFiles

export function __setCallbackInterceptor(interceptor: (type: string, cb: (err?: any) => void) => void): void {
	fs.__cb = interceptor
}
fs.__setCallbackInterceptor = __setCallbackInterceptor
export function __restoreCallbackInterceptor(): void {
	fs.__cb = (_type: string, cb: () => void) => {
		return cb()
	}
}
fs.__restoreCallbackInterceptor = __restoreCallbackInterceptor
fs.__restoreCallbackInterceptor()

interface ErrorArguments {
	errno: number
	code: string
	syscall: string
	path: string
}
const errors = {
	ENOENT: (args: ErrorArguments) => Object.assign(new Error(`ENOENT: no such file or directory ${args.path}`), args),
	ENOTDIR: (args: ErrorArguments) => Object.assign(new Error(`ENOTDIR: not a directory ${args.path}`), args),
}
function fixPath(path: string) {
	const mountedDrives = wndMock.__mountedDrives
	for (const [driveLetter, mountedPath] of Object.entries<wndMock0.DriveInfo>(mountedDrives)) {
		path = path.replace(new RegExp(`^${driveLetter}:`), mountedPath.path)
	}

	return path.replace(/^\\\\/, '\\').replace(/\\/g, '/').replace(/\/\//g, '/')
}

export function __mockReset(): void {
	Object.keys(mockRoot.content).forEach((filePath) => delete mockRoot.content[filePath])
	fsMockEmitter.removeAllListeners()
}
fs.__mockReset = __mockReset

export function __mockSetFile(path: string, size: number, accessOptions?: FileAccess): void {
	path = fixPath(path)
	setMock(
		path,
		{
			accessRead: accessOptions?.accessRead ?? true,
			accessWrite: accessOptions?.accessWrite ?? true,

			isDirectory: false,
			content: 'mockContent',
			size: size,
		},
		true,
		true
	)
}
fs.__mockSetFile = __mockSetFile
export function __mockDeleteFile(path: string): void {
	path = fixPath(path)
	deleteMock(path)
}
fs.__mockDeleteFile = __mockDeleteFile
export function __mockSetDirectory(path: string, accessOptions?: FileAccess): void {
	path = fixPath(path)
	setMock(
		path,
		{
			accessRead: accessOptions?.accessRead ?? true,
			accessWrite: accessOptions?.accessWrite ?? true,

			isDirectory: true,
			content: {},
		},
		true,
		true
	)
}
fs.__mockSetDirectory = __mockSetDirectory

export function __emitter(): EventEmitter {
	return fsMockEmitter
}
fs.__emitter = __emitter

export enum constants {
	F_OK = 0,
	X_OK = 1,
	W_OK = 2,
	R_OK = 4,
}
fs.constants = constants

export function stat(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	debugLog('fs.stat', path)
	fsMockEmitter.emit('stat', path)
	try {
		const mockFile = getMock(path)
		if (mockFile.isDirectory) {
			callback(undefined, {
				size: -1, // ?
			})
		} else {
			callback(undefined, {
				size: mockFile.size,
			})
		}
	} catch (err) {
		callback(err)
	}
}
fs.stat = stat

export function access(path: string, mode: number | undefined, callback: (error: any, result?: any) => void): void {
	if (mode === undefined)
		throw new Error(
			`Mock fs.access: Don't use mode===undefined in Package Manager (or perhaps the mock fs constants aren't setup correctly?)`
		)
	path = fixPath(path)
	const mockFile = getMock(path)
	// debugLog('fs.access', path, mode)
	fsMockEmitter.emit('access', path, mode)
	setTimeout(() => {
		try {
			if (mode === constants.R_OK && !mockFile.accessRead) {
				return callback({ someError: 'Mock: read access denied ' })
			} else if (mode === constants.W_OK && !mockFile.accessWrite) {
				return callback({ someError: 'Mock: write access denied ' })
			} else {
				return callback(undefined, null)
			}
		} catch (err) {
			callback(err)
		}
	}, FS_ACCESS_DELAY)
}
fs.access = access
let FS_ACCESS_DELAY = 0
export function __mockSetAccessDelay(delay: number): void {
	FS_ACCESS_DELAY = delay
}
fs.__mockSetAccessDelay = __mockSetAccessDelay

export function unlink(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	debugLog('fs.unlink', path)
	fsMockEmitter.emit('unlink', path)
	try {
		deleteMock(path)
		return callback(undefined, null)
	} catch (err) {
		callback(err)
	}
}
fs.unlink = unlink

export function mkdir(path: string, callback: (error: any, result?: any) => void): void
export function mkdir(path: string, opts: { recursive?: boolean }, callback: (error: any, result?: any) => void): void
export function mkdir(
	path: string,
	optsOrCallback: { recursive?: boolean } | ((error: any, result?: any) => void),
	callback?: (error: any, result?: any) => void
): void {
	let opts: { recursive?: boolean }
	if (typeof optsOrCallback === 'function') {
		callback = optsOrCallback
		opts = {}
	} else {
		opts = optsOrCallback
	}

	path = fixPath(path)
	debugLog('fs.mkdir', path)
	fsMockEmitter.emit('mkdir', path)

	try {
		// Handle if the directory already exists:
		if (existsMock(path)) {
			const existing = getMock(path)
			if (existing.isDirectory && opts.recursive) {
				// don't do anything
				return callback?.(undefined, null)
			} else {
				throw Object.assign(new Error(`EEXIST: file already exists, mkdir "${path}"`), {
					errno: 0,
					code: 'EEXIST',
					syscall: 'mock',
					path: path,
				})
			}
		}

		setMock(
			path,
			{
				accessRead: true,
				accessWrite: true,
				isDirectory: true,
				content: {},
			},
			opts.recursive ?? false
		)

		return callback?.(undefined, null)
	} catch (err) {
		callback?.(err)
	}
}
fs.mkdir = mkdir

export function readdir(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	debugLog('fs.readdir', path)
	fsMockEmitter.emit('readdir', path)
	try {
		const mockFile = getMock(path)
		if (!mockFile.isDirectory) {
			return callback(errors.ENOTDIR({ errno: -4052, code: 'ENOTDIR', syscall: 'scandir', path: path }))
		} else {
			return callback(undefined, mockFile.content)
		}
	} catch (err) {
		callback(err)
	}
}
fs.readdir = readdir

export function lstat(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	debugLog('fs.lstat', path)
	fsMockEmitter.emit('lstat', path)
	try {
		const mockFile = getMock(path)
		return callback(undefined, {
			size: mockFile.isDirectory ? 0 : mockFile.size,
			isDirectory: () => mockFile.isDirectory,
		})
	} catch (err) {
		callback(err)
	}
}
fs.lstat = lstat

export function writeFile(path: string, data: Buffer | string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	debugLog('fs.writeFile', path)
	fsMockEmitter.emit('writeFile', path, data)
	try {
		setMock(
			path,
			{
				accessRead: true,
				accessWrite: true,
				isDirectory: false,
				content: data,
				size: data.length,
			},
			false
		)
		return callback(undefined, null)
	} catch (err) {
		callback(err)
	}
}
fs.writeFile = writeFile
function readFile(path: string, ...args: any[]): void {
	path = fixPath(path)

	let callback: (error: any, result?: any) => void
	if (args.length === 1) {
		callback = args[0]
	} else if (args.length === 2) {
		// const options = args[0]
		callback = args[1]
	} else throw new Error(`Mock poorly implemented: ` + args)

	debugLog('fs.readFile', path)
	fsMockEmitter.emit('readFile', path)
	try {
		const file = getMock(path)
		return callback(undefined, file.content)
	} catch (err) {
		callback(err)
	}
}
fs.readFile = readFile

export function open(path: string, _options: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	debugLog('fs.open', path)

	fsMockEmitter.emit('open', path)
	return fs.__cb('open', (err: unknown) => {
		try {
			const file = getMock(path)
			fdId++
			openFileDescriptors[fdId + ''] = file
			if (err) return callback(err)
			else return callback(undefined, fdId)
		} catch (err) {
			callback(err)
		}
	})
}
fs.open = open
export function close(fd: number, callback: (error: any, result?: any) => void): void {
	debugLog('fs.close')
	fsMockEmitter.emit('close', fd)
	if (openFileDescriptors[fd + '']) {
		delete openFileDescriptors[fd + '']
		return callback(undefined, null)
	} else {
		return callback(new Error(`Mock: File handle ${fd} not found`), null)
	}
}
fs.close = close
export function copyFile(source: string, destination: string, callback: (error: any, result?: any) => void): void {
	source = fixPath(source)
	destination = fixPath(destination)
	const destinationFolder = destination.replace(/[^\\/]+$/, '')
	debugLog('fs.copyFile', source, destination)

	fsMockEmitter.emit('copyFile', source, destination)
	return fs.__cb('copyFile', (err: unknown) => {
		try {
			const mockFile = getMock(source)
			debugLog('source', source)
			debugLog('mockFile', mockFile)
			debugLog('destination', destination)

			const destinationFolderMock = getMock(destinationFolder)
			if (!destinationFolderMock.accessWrite) throw new Error(`Not allowed to write to "${destinationFolder}"`)

			setMock(destination, mockFile, false)

			if (err) return callback(err, null)
			else return callback(undefined, null)
		} catch (err) {
			callback(err)
		}
	})
}
fs.copyFile = copyFile
export function rename(source: string, destination: string, callback: (error: any, result?: any) => void): void {
	source = fixPath(source)
	destination = fixPath(destination)
	debugLog('fs.rename', source, destination)
	fsMockEmitter.emit('rename', source, destination)
	return fs.__cb('rename', (err: unknown) => {
		try {
			const mockFile = getMock(source)
			setMock(destination, mockFile, false)
			deleteMock(source)

			if (err) return callback(err, null)
			return callback(undefined, null)
		} catch (err) {
			callback(err)
		}
	})
}
fs.rename = rename
export function utimes(
	_fileName: string,
	_atime: Date,
	_mtime: Date,
	callback: (error: any, result?: any) => void
): void {
	// This is currently a no-op, since there isn't any support for atime/mtime in this mock
	callback(undefined, undefined)
}
fs.rename = utimes

export function createReadStream(path: string, _options?: BufferEncoding | undefined): FSReadStream {
	return new FSReadStream(path)
}

fs.createReadStream = createReadStream

export function createWriteStream(path: string, _options?: BufferEncoding | undefined): FSWriteStream {
	return new FSWriteStream(path)
}
fs.createWriteStream = createWriteStream

const DEBUG_STREAMS = false
function debugStreamsLog(...args: any[]): void {
	// eslint-disable-next-line no-console
	if (DEBUG_STREAMS) console.log(...args)
}
class FSReadStream extends Readable {
	constructor(public path: string) {
		debugStreamsLog('READ created')
		super()
	}
	_construct(callback: () => void) {
		if (!this.path) this.emit('error', 'MOCK: path is not set!')
		callback()
		this.emit('open')
	}

	private readI = 0
	_read(_size: number): void {
		debugStreamsLog('READ read')
		if (this.readI === 0) {
			this.push(JSON.stringify({ sourcePath: this.path }))
		} else {
			this.push(null)
		}
		this.readI++
	}
	pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean | undefined } | undefined): T {
		debugStreamsLog('READ pipe')
		return super.pipe(destination, options)
	}
	close() {
		// nothing?
	}
}
class FSWriteStream extends Writable {
	constructor(public path: string) {
		debugStreamsLog('WRITE created')
		super()
	}
	_construct(callback: () => void) {
		if (!this.path) this.emit('error', 'MOCK: path is not set!')
		callback()
	}

	_write(chunk: any, _encoding: any, callback: (err?: any) => void) {
		const chunkStr = String(chunk)

		debugStreamsLog('WRITE write', chunkStr)
		const obj = JSON.parse(chunkStr)

		if (obj.sourcePath) {
			debugStreamsLog('COPY', obj.sourcePath, this.path)
			copyFile(obj.sourcePath, this.path, (error, _result) => {
				if (error) {
					// this.emit('error', error)
					callback(error)
				} else {
					// this.emit('close')
					callback()
				}
			})
		} else {
			callback()
		}
	}
	_final(callback: () => void) {
		debugStreamsLog('WRITE final')
		callback()
	}
	close() {
		// nothing?
	}
}

interface FileAccess {
	accessRead: boolean
	accessWrite: boolean
}

fs.promises = {
	stat: promisify(stat),
	access: promisify(access),
	unlink: promisify(unlink),
	mkdir: promisify(mkdir),
	readdir: promisify(readdir),
	lstat: promisify(lstat),
	writeFile: promisify(writeFile),
	readFile: promisify(readFile),
	open: promisify(open),
	copyFile: promisify(copyFile),
	rename: promisify(rename),
	utimes: promisify(utimes),
}

module.exports = fs
