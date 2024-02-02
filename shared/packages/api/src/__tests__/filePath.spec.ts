import { escapeFilePath } from '../filePath'

describe('filePath', () => {
	test('checkPath', () => {
		expect(escapeFilePath('test/path')).toBe(process.platform === 'win32' ? '"test/path"' : 'test/path')
		expect(escapeFilePath('C:\\test\\path')).toBe(process.platform === 'win32' ? '"C:\\test\\path"' : 'C:\\test\\path')
	})
})
