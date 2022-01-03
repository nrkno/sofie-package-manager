import { ACTION_TIMEOUT, INNER_ACTION_TIMEOUT, MESSAGE_TIMEOUT, PING_TIME } from '../websocketConnection'

describe('websocketConnection', () => {
	test('constants', () => {
		expect(PING_TIME).toBeGreaterThan(0)
		expect(MESSAGE_TIMEOUT).toBeGreaterThan(0)
		expect(ACTION_TIMEOUT).toBeGreaterThan(0)
		expect(INNER_ACTION_TIMEOUT).toBeGreaterThan(0)
	})
})
