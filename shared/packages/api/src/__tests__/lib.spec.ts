import { diff } from '../lib'

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
})
export {}
