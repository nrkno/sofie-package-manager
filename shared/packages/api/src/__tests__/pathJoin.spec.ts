import { rebaseUrl } from '../pathJoin'
test('rebaseUrl', () => {
	expect(rebaseUrl('https://a', 'b')).toBe('https://a/b')
	expect(rebaseUrl('https://a/', 'b')).toBe('https://a/b')
	expect(rebaseUrl('https://a/', '/b')).toBe('https://a/b')
	expect(rebaseUrl('file://a/', '/b/')).toBe('file://a/b/')
	expect(rebaseUrl('https:////a/b/', 'c')).toBe('https://a/b/c')
	expect(rebaseUrl('https://a/', '//b/')).toBe('https://a/b/')

	expect(rebaseUrl('https://a/b//c/', '/d/e//f/')).toBe('https://a/b/c/d/e/f/')
})
