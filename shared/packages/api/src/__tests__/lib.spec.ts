import { deferGets, diff, promiseTimeout, stringifyError, waitTime } from '../lib'

describe('lib', () => {
	test('diff', () => {
		expect(diff(undefined, undefined)).toEqual(null)
		expect(diff(null, null)).toEqual(null)
		expect(diff(1, 1)).toEqual(null)
		expect(diff('a', 'a')).toEqual(null)
		expect(diff({}, {})).toEqual(null)
		expect(diff({ a: 1 }, { a: 1 })).toEqual(null)
		expect(diff([], [])).toEqual(null)
		expect(diff([1], [1])).toEqual(null)

		expect(diff(1, 2)).toEqual('1 !== 2')
		expect(diff(1, null)).toEqual('1 !== null')
		expect(diff(1, undefined)).toEqual('1 !== undefined')

		expect(diff(1, {})).toEqual('type number !== object')
		expect(diff({}, 1)).toEqual('type object !== number')
		expect(diff([], {})).toEqual('array !== object')
		expect(diff({}, [])).toEqual('object !== array')

		expect(diff(1, [])).toEqual('type number !== object')

		expect(diff({ a: 1 }, { a: 0 })).toEqual('a: 1 !== 0')
		expect(diff({ a: { b: { c: 1 } } }, { a: { b: { c: 0 } } })).toEqual('a.b.c: 1 !== 0')

		expect(diff([], [1])).toEqual('length: 0 !== 1')
		expect(diff([2], [1])).toEqual('0: 2 !== 1')

		expect(
			diff(
				{
					a: {
						b: {
							c: [
								{
									d: 1,
								},
								{
									e: 1,
								},
							],
						},
					},
				},
				{
					a: {
						b: {
							c: [
								{
									d: 1,
								},
								{
									e: 2,
								},
							],
						},
					},
				}
			)
		).toEqual('a.b.c.1.e: 1 !== 2')
	})
	test('promiseTimeout', async () => {
		await expect(promiseTimeout(Promise.resolve(42), 300)).resolves.toEqual(42)
		await expect(promiseTimeout(Promise.reject('errr'), 300)).rejects.toEqual('errr')

		// @ts-expect-error input is a value, not a promise
		await expect(promiseTimeout(42, 300)).resolves.toEqual(42)

		await expect(
			promiseTimeout(
				(async () => {
					await waitTime(50)
					return 100
				})(),
				300
			)
		).resolves.toEqual(100)

		await expect(
			promiseTimeout(
				(async () => {
					await waitTime(50)
					throw new Error('errr')
				})(),
				300
			)
		).rejects.toEqual(Error('errr'))

		// Times out:
		await expect(
			promiseTimeout(
				(async () => {
					await waitTime(1000)
					return 100
				})(),
				300
			)
		).rejects.toEqual('Timeout')

		await expect(
			promiseTimeout(
				(async () => {
					await waitTime(1000)
					return 100
				})(),
				300,
				`Custom timeout`
			)
		).rejects.toEqual('Custom timeout')
	})

	test('stringifyError', async () => {
		const err = new Error('errr')
		const obj = {
			message: 'err message',
			event: {
				type: 'myevent',
			},
		}
		const objReason = {
			reason: 'err reason',
		}
		const emptyObject = {}
		const errWithContext = new Error('errr')
		;(errWithContext as any).context = 'a context'

		expect(stringifyError('asdf')).toEqual('asdf')
		expect(stringifyError(err, true)).toEqual('Error: errr')
		expect(stringifyError(err)).toMatch(/Error: errr[\s\S]*lib\.spec\.ts/gm)

		expect(stringifyError(obj)).toEqual('{"message":"err message","event":{"type":"myevent"}}')
		expect(stringifyError(objReason)).toEqual('err reason')
		expect(stringifyError(emptyObject)).toEqual('{}')

		expect(stringifyError(errWithContext, true)).toEqual('Error: errr, Context: a context')
	})
	test('deferGets', async () => {
		let i = 0
		const deferred = deferGets(async (val: string) => {
			await waitTime(10)
			return `${val}_${i++}`
		})

		const values = await Promise.all([
			deferred('a', 'a1'), // will be executed
			deferred('b', 'b2'), // will be executed
			deferred('a', 'a3'), // will not be executed
			deferred('a', 'a4'), // will not be executed
			deferred('c', 'c5'), // will be executed
			deferred('a', 'a6'), // will not be executed
			deferred('b', 'b7'), // will not be executed
		])

		const values2 = await Promise.all([
			deferred('a', 'a8'), // will be executed
			deferred('a', 'a9'), // will not be executed
			deferred('b', 'b10'), // will be executed
			deferred('a', 'a11'), // will not be executed
		])

		expect(values).toEqual([
			'a1_0', // was executed
			'b2_1', // was executed
			'a1_0', // was not executed
			'a1_0', // was not executed
			'c5_2', // was executed
			'a1_0', // was not executed
			'b2_1', // was not executed
		])
		expect(values2).toEqual([
			'a8_3', // was executed
			'a8_3', // was not executed
			'b10_4', // was executed
			'a8_3', // was not executed
		])
		expect(i).toBe(5)
	})
})
export {}
