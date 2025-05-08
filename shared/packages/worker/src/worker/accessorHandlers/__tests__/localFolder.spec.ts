import {
	AccessorOnPackage,
	protectString,
	setupLogger,
	initializeLogger,
	ProcessConfig,
	Expectation,
	Accessor,
} from '@sofie-package-manager/api'
import { Content, LocalFolderAccessorHandle } from '../localFolder'
import { PassiveTestWorker } from './lib'

const processConfig: ProcessConfig = {
	logPath: undefined,
	logLevel: undefined,
	unsafeSSL: false,
	certificates: [],
}
initializeLogger({ process: processConfig })
test('checkHandleBasic', () => {
	const logger = setupLogger(
		{
			process: processConfig,
		},
		''
	)
	const worker = new PassiveTestWorker(logger)

	function getLocalFolderAccessor(
		accessor: AccessorOnPackage.LocalFolder,
		content: Content,
		workOptions: Expectation.WorkOptions.Base &
			Expectation.WorkOptions.RemoveDelay &
			Expectation.WorkOptions.UseTemporaryFilePath = {}
	) {
		accessor.type = Accessor.AccessType.LOCAL_FOLDER
		return new LocalFolderAccessorHandle({
			worker,
			accessorId: protectString('local0'),
			accessor,
			context: { expectationId: 'exp0' },
			content,
			workOptions,
		})
	}

	expect(() => getLocalFolderAccessor({}, {}).checkHandleBasic()).toThrowError('Bad input data')

	// missing accessor.folderPath:
	expect(getLocalFolderAccessor({}, { filePath: 'amb.amp4' }).checkHandleBasic()).toMatchObject({
		success: false,
		reason: { tech: 'Folder path not set' },
	})

	// All OK:
	expect(getLocalFolderAccessor({ folderPath: '/a/b/c' }, { filePath: 'amb.amp4' }).checkHandleBasic()).toMatchObject(
		{
			success: true,
		}
	)

	// Absolute file path:
	expect(
		getLocalFolderAccessor({ folderPath: '/base/media' }, { filePath: '//secret/amb.amp4' }).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: { tech: expect.stringMatching(/File path.*absolute path/) },
	})
	expect(
		getLocalFolderAccessor({ folderPath: 'D:\\media' }, { filePath: 'C:\\secret\\amb.amp4' }).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: { tech: expect.stringMatching(/File path.*absolute path/) },
	})

	// File path outside of folder path:
	expect(
		getLocalFolderAccessor({ folderPath: '/base/media' }, { filePath: '../secret/amb.amp4' }).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: {
			user: `File path is outside of folder path`,
			tech: expect.stringMatching(/Full path.*does not start with/),
		},
	})
})
