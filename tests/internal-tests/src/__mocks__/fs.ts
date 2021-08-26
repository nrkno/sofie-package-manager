// eslint-disable-next-line node/no-unpublished-import
import fsMockType from 'windows-network-drive' // Note: this is a mocked module
// import * as Path from 'path'

/* eslint-disable no-console */
const DEBUG_LOG = false

enum fsConstants {
	R_OK = 2,
	W_OK = 4,
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

function getMock(path: string, orgPath?: string, dir?: MockDirectory): MockAny {
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
				throw Object.assign(new Error(`ENOTDIR: not a directory ${orgPath}`), {
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
	throw Object.assign(new Error(`ENOENT: no such file or directory ${orgPath}`), {
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
				throw Object.assign(new Error(`ENOENT: no such file or directory ${path}`), {
					errno: -4058,
					code: 'ENOENT',
					syscall: 'mock',
					path: path,
				})
			}
		}
		const nextDir = dir.content[dirName]
		if (!nextDir.accessWrite) {
			throw Object.assign(new Error(`EACCESS: Not able to write ${path}`), {
				errno: 0,
				code: 'EACCESS',
				syscall: 'mock',
				path: path,
			})
		}
		if (!nextDir.isDirectory) {
			throw Object.assign(new Error(`ENOTDIR: not a directory ${path}`), {
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

		if (DEBUG_LOG) console.log('setMock', path, create)
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
export function __printAllFiles(): string {
	const getPaths = (dir: MockDirectory, indent: string): string => {
		const strs: any[] = []
		for (const [name, file] of Object.entries(dir.content)) {
			if (file.isDirectory) {
				strs.push(`${indent}${name}/`)
				strs.push(getPaths(file, indent + '  '))
			} else {
				strs.push(`${indent}${name}: size: ${file.size}`)
			}
		}
		return strs.join('\n')
	}
	return getPaths(mockRoot, '')
}
fs.__printAllFiles = __printAllFiles

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
	// @ts-expect-error mock
	const mountedDrives: { [key: string]: string } = fsMockType.__mountedDrives
	for (const [driveLetter, mountedPath] of Object.entries(mountedDrives)) {
		path = path.replace(new RegExp(`^${driveLetter}:`), mountedPath)
	}

	return path.replace(/^\\\\/, '\\').replace(/\\/g, '/').replace(/\/\//g, '/')
}

export function __mockReset(): void {
	Object.keys(mockRoot.content).forEach((filePath) => delete mockRoot.content[filePath])
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

export function stat(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	if (DEBUG_LOG) console.log('fs.stat', path)
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
	path = fixPath(path)
	if (DEBUG_LOG) console.log('fs.access', path, mode)
	try {
		const mockFile = getMock(path)
		if (mode === fsConstants.R_OK && !mockFile.accessRead) {
			return callback({ someError: 'Mock: read access denied ' })
		} else if (mode === fsConstants.W_OK && !mockFile.accessWrite) {
			return callback({ someError: 'Mock: write access denied ' })
		} else {
			return callback(undefined, null)
		}
	} catch (err) {
		callback(err)
	}
}
fs.access = access

export function unlink(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	if (DEBUG_LOG) console.log('fs.unlink', path)
	try {
		deleteMock(path)
		return callback(undefined, null)
	} catch (err) {
		callback(err)
	}
}
fs.unlink = unlink

export function mkdir(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	if (DEBUG_LOG) console.log('fs.mkdir', path)
	try {
		setMock(
			path,
			{
				accessRead: true,
				accessWrite: true,
				isDirectory: true,
				content: {},
			},
			false
		)

		return callback(undefined, null)
	} catch (err) {
		callback(err)
	}
}
fs.mkdir = mkdir

export function readdir(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	if (DEBUG_LOG) console.log('fs.readdir', path)
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
	if (DEBUG_LOG) console.log('fs.lstat', path)
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
	if (DEBUG_LOG) console.log('fs.writeFile', path)
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
function readFile(path: string, callback: (error: any, result?: any) => void): void {
	path = fixPath(path)
	if (DEBUG_LOG) console.log('fs.readFile', path)
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
	if (DEBUG_LOG) console.log('fs.open', path)
	try {
		const file = getMock(path)
		fdId++
		openFileDescriptors[fdId + ''] = file

		return callback(undefined, fdId)
	} catch (err) {
		callback(err)
	}
}
fs.open = open
export function close(fd: number, callback: (error: any, result?: any) => void): void {
	if (DEBUG_LOG) console.log('fs.close')
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
	if (DEBUG_LOG) console.log('fs.copyFile', source, destination)
	try {
		const mockFile = getMock(source)
		if (DEBUG_LOG) console.log('source', source)
		if (DEBUG_LOG) console.log('mockFile', mockFile)
		if (DEBUG_LOG) console.log('destination', destination)
		setMock(destination, mockFile, false)
		return callback(undefined, null)
	} catch (err) {
		callback(err)
	}
}
fs.copyFile = copyFile
export function rename(source: string, destination: string, callback: (error: any, result?: any) => void): void {
	source = fixPath(source)
	destination = fixPath(destination)
	if (DEBUG_LOG) console.log('fs.rename', source, destination)
	try {
		const mockFile = getMock(source)
		setMock(destination, mockFile, false)
		deleteMock(source)
		return callback(undefined, null)
	} catch (err) {
		callback(err)
	}
}
fs.rename = rename

interface FileAccess {
	accessRead: boolean
	accessWrite: boolean
}

module.exports = fs
