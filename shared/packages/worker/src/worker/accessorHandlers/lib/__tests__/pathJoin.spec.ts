import { joinUrls } from '../pathJoin'
test('joinUrls', () => {
	expect(joinUrls('a', 'b')).toBe('a/b')
	expect(joinUrls('a/', 'b')).toBe('a/b')
	expect(joinUrls('a/', '/b')).toBe('a/b')
	expect(joinUrls('a/', '/b/')).toBe('a/b/')
	expect(joinUrls('//a/b/', 'c')).toBe('/a/b/c')
	expect(joinUrls('a/', '//b/')).toBe('a/b/')

	expect(joinUrls('a/b//c/', '/d/e//f/')).toBe('a/b/c/d/e/f/')
})
