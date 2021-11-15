import { Accessor } from '../inputApi'

describe('inputApi', () => {
	test('checkAssertions', () => {
		// We don't have to actually test anything here,
		// if there is an issue, the assertions in in inputApi.ts will throw upon startup
		expect(Accessor.AccessType.FILE_SHARE).toBe('file_share')
	})
})
