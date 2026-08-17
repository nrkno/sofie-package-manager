// Mock resolveFileWithoutExtension before importing modules
const mockResolveFileWithoutExtension = jest.fn()
const mockFsReaddir = jest.fn()

jest.mock('fs', () => {
	const actual = jest.requireActual('fs')
	return {
		...actual,
		readdir: mockFsReaddir,
	}
})

jest.mock('@sofie-package-manager/api', () => {
	const actual = jest.requireActual('@sofie-package-manager/api')
	return {
		...actual,
		resolveFileWithoutExtension: mockResolveFileWithoutExtension,
	}
})

import {
	AccessorOnPackage,
	protectString,
	setupLogger,
	initializeLogger,
	ProcessConfig,
	Accessor,
} from '@sofie-package-manager/api'
import { Content, LocalFolderAccessorHandle } from '../localFolder'
import { PassiveTestWorker } from './lib'
import path from 'node:path'

describe('matchFilenamesWithoutExtension for LocalFolder', () => {
	beforeAll(() => {
		initializeLogger({
			process: {
				logPath: undefined,
				logLevel: undefined,
				unsafeSSL: false,
				certificates: [],
			},
		})
	})
	const processConfig: ProcessConfig = {
		logPath: undefined,
		logLevel: undefined,
		unsafeSSL: false,
		certificates: [],
	}

	const createAccessor = (worker: PassiveTestWorker, folderPath: string, filePath = 'testfile') => {
		return new LocalFolderAccessorHandle<Content>({
			worker,
			accessorId: protectString('local0'),
			accessor: {
				type: Accessor.AccessType.LOCAL_FOLDER,
				folderPath: folderPath,
			} as AccessorOnPackage.LocalFolder,
			context: { expectationId: 'exp0' },
			content: { filePath },
			workOptions: {},
		})
	}

	test('should resolve file with single extension match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		const expectedPath = path.join(folderPath, 'testfile.mp4')
		const fullPathWithoutExt = path.join(folderPath, 'testfile')
		const filesInDir = ['testfile.mp4', 'other.mov']
		mockFsReaddir.mockImplementation((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, filesInDir)
		})

		// Mock resolveFileWithoutExtension to return a single match
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'found',
			fullPath: expectedPath,
			extension: '.mp4',
		})

		const accessor = createAccessor(worker, folderPath)

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(mockResolveFileWithoutExtension).toHaveBeenCalledWith(fullPathWithoutExt, filesInDir)
	})

	test('should throw error when multiple files match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		const filesInDir = ['testfile.mp4', 'testfile.mov', 'testfile.avi']
		mockFsReaddir.mockImplementation((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, filesInDir)
		})

		// Mock resolveFileWithoutExtension to return multiple matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'multiple',
			matches: [
				path.join(folderPath, 'testfile.mp4'),
				path.join(folderPath, 'testfile.mov'),
				path.join(folderPath, 'testfile.avi'),
			],
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/Multiple files found matching/)
	})

	test('should throw error when no files match', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		mockFsReaddir.mockImplementation((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, ['unrelated.mov'])
		})

		// Mock resolveFileWithoutExtension to return no matches
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'notFound',
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/File not found/)
	})

	test('should retry resolving after notFound (late delivery)', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		const expectedPath = path.join(folderPath, 'testfile.mp4')
		const fullPathWithoutExt = path.join(folderPath, 'testfile')
		const filesInDir = ['testfile.mp4']
		mockFsReaddir.mockImplementation((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, filesInDir)
		})

		mockResolveFileWithoutExtension
			.mockResolvedValueOnce({
				result: 'notFound',
			})
			.mockResolvedValueOnce({
				result: 'found',
				fullPath: expectedPath,
				extension: '.mp4',
			})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/File not found/)

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(mockResolveFileWithoutExtension).toHaveBeenCalledTimes(2)
		expect(mockResolveFileWithoutExtension).toHaveBeenNthCalledWith(1, fullPathWithoutExt, filesInDir)
		expect(mockResolveFileWithoutExtension).toHaveBeenNthCalledWith(2, fullPathWithoutExt, filesInDir)
	})

	test('should resolve file with compound extension', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		const expectedPath = path.join(folderPath, 'archive.tar.gz')
		mockFsReaddir.mockImplementation((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(null, ['archive.tar.gz'])
		})

		// Mock resolveFileWithoutExtension to return a compound extension match
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'found',
			fullPath: expectedPath,
			extension: '.tar.gz',
		})

		const accessor = createAccessor(worker, folderPath, 'archive')

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
	})

	test('should not use extension matching when feature is disabled', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, false)

		const resolveSpy = mockResolveFileWithoutExtension

		const folderPath = path.join('test', 'folder')
		const expectedPath = path.join(folderPath, 'testfile')

		const accessor = createAccessor(worker, folderPath)

		const result = await accessor.getResolvedFullPath()
		expect(result).toBe(expectedPath)
		expect(resolveSpy).not.toHaveBeenCalled()
	})

	test('should use an empty directory listing when directory does not exist', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		const fullPathWithoutExt = path.join(folderPath, 'testfile')
		const enoent = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
		enoent.code = 'ENOENT'
		mockFsReaddir.mockImplementation((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(enoent)
		})

		// Even when folder doesn't exist, resolver is called with empty listing.
		mockResolveFileWithoutExtension.mockResolvedValue({
			result: 'notFound',
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/File not found/)
		expect(mockResolveFileWithoutExtension).toHaveBeenCalledWith(fullPathWithoutExt, [])
	})

	test('should throw error when directory listing fails for other reasons', async () => {
		const logger = setupLogger({ process: processConfig }, '')
		const worker = new PassiveTestWorker(logger, processConfig, true)

		const folderPath = path.join('test', 'folder')
		const eacces = new Error('EACCES: permission denied') as NodeJS.ErrnoException
		eacces.code = 'EACCES'
		mockFsReaddir.mockImplementation((_: string, cb: (err: Error | null, files?: string[]) => void) => {
			cb(eacces)
		})

		const accessor = createAccessor(worker, folderPath)

		await expect(accessor.getResolvedFullPath()).rejects.toThrow(/Error listing files in/)
		expect(mockResolveFileWithoutExtension).not.toHaveBeenCalled()
	})

	afterEach(() => {
		mockResolveFileWithoutExtension.mockReset()
		mockFsReaddir.mockReset()
	})
})
