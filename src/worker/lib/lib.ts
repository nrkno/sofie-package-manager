import * as crypto from 'crypto'
export function literal<T>(o: T): T {
	return o
}
export function hashObj(obj: any): string {
	if (typeof obj === 'object') {
		const keys = Object.keys(obj).sort((a, b) => {
			if (a > b) return 1
			if (a < b) return -1
			return 0
		})

		const strs: string[] = []
		for (const key of keys) {
			strs.push(hashObj(obj[key]))
		}
		return hash(strs.join('|'))
	}
	return obj + ''
}
export function hash(str: string): string {
	const hash = crypto.createHash('sha1')
	return hash.update(str).digest('hex')
}
