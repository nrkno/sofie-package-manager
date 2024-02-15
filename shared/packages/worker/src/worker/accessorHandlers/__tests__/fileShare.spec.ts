import {
	AccessorOnPackage,
	protectString,
	setupLogger,
	initializeLogger,
	ProcessConfig,
	Expectation,
	Accessor,
} from '@sofie-package-manager/api'
import { Content, FileShareAccessorHandle } from '../fileShare'
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

	function getFileShareAccessor(
		accessor: AccessorOnPackage.FileShare,
		content: Content,
		workOptions: Expectation.WorkOptions.Base &
			Expectation.WorkOptions.RemoveDelay &
			Expectation.WorkOptions.UseTemporaryFilePath = {}
	) {
		accessor.type = Accessor.AccessType.FILE_SHARE
		return new FileShareAccessorHandle(worker, protectString('share0'), accessor, content, workOptions)
	}

	expect(() => getFileShareAccessor({}, {}).checkHandleBasic()).toThrowError('Bad input data')

	// missing accessor.folderPath:
	expect(getFileShareAccessor({}, { filePath: 'amb.amp4' }).checkHandleBasic()).toMatchObject({
		success: false,
		reason: { tech: 'Folder path not set' },
	})

	// All OK:
	expect(
		getFileShareAccessor({ folderPath: '\\\\nas01\\media' }, { filePath: 'amb.amp4' }).checkHandleBasic()
	).toMatchObject({ success: true })

	// Absolute file path:
	expect(
		getFileShareAccessor({ folderPath: '\\\\nas01\\media' }, { filePath: '//secret/amb.amp4' }).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: { tech: expect.stringMatching(/File path.*absolute path/) },
	})
	expect(
		getFileShareAccessor(
			{ folderPath: '\\\\nas01\\media' },
			{ filePath: 'C:\\secret\\amb.amp4' }
		).checkHandleBasic()
	).toMatchObject({
		success: false,
		reason: { tech: expect.stringMatching(/File path.*absolute path/) },
	})

	// File path outside of folder path:
	// Something strange happening in with path.join() when the folder begins with double slashes, so can't test this..
	// expect(
	// 	getFileShareAccessor({ folderPath: '//nas01/media' }, { filePath: '../secret/amb.amp4' }).checkHandleBasic()
	// ).toMatchObject({
	// 	success: false,
	// 	reason: {
	// 		user: `File path is outside of folder path`,
	// 		tech: expect.stringMatching(/Full path.*does not start with/),
	// 	},
	// })
})
