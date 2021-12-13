import crypto from 'crypto'

/** Helper function to force the input to be of a certain type. */
export function literal<T>(o: T): T {
	return o
}
/**
 * Returns a string that changes whenever the input changes.
 * Does NOT depend on the order of object attributes.
 */
export function hashObj(obj: unknown): string {
	if (!obj) {
		return ''
	} else if (Array.isArray(obj)) {
		const strs: string[] = []
		for (const value of obj) {
			strs.push(hashObj(value))
		}
		return hash(strs.join(','))
	} else if (typeof obj === 'object') {
		if (!obj) return 'null'

		// Sort the keys, so that key order doesn't matter:
		const keys = Object.keys(obj).sort((a, b) => {
			if (a > b) return 1
			if (a < b) return -1
			return 0
		})

		const strs: string[] = []
		for (const key of keys) {
			strs.push(hashObj((obj as any)[key]))
		}
		return hash(strs.join('|'))
	} else {
		return obj + ''
	}
}
export function hash(str: string): string {
	const hash0 = crypto.createHash('sha1')
	return hash0.update(str).digest('hex')
}
/** Helper function to simply assert that the value is of the type never */
export function assertNever(_value: never): void {
	// does nothing
}
export function waitTime(duration: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, duration)
	})
}
export function promiseTimeout<T>(p: Promise<T>, timeoutTime: number, timeoutMessage?: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(timeoutMessage || 'Timeout')
		}, timeoutTime)

		Promise.resolve(p)
			.then(resolve)
			.catch(reject)
			.finally(() => {
				clearTimeout(timeout)
			})
	})
}
/**
 * Does a deep comparison to see if the properties of the objects are equal.
 * @returns true if objects are equal
 */
export function deepEqual<T>(object1: T, object2: T): boolean {
	const areObjects = isObject(object1) && isObject(object2)
	if (areObjects) {
		if (Array.isArray(object1) !== Array.isArray(object2)) return false

		const keys1 = Object.keys(object1)
		const keys2 = Object.keys(object2)
		if (keys1.length !== keys2.length) return false

		for (const key of keys1) {
			if (!deepEqual((object1 as any)[key], (object2 as any)[key])) {
				return false
			}
		}

		return true
	} else {
		return object1 === object2
	}
}
function isObject(obj: unknown): obj is { [key: string]: any } {
	return obj != null && typeof obj === 'object'
}
/** Make a string out of an error, including any additional data such as stack trace if available */
export function stringifyError(error: unknown, noStack = false): string {
	let str = `${error}`

	if (error && typeof error === 'object' && (error as any).reason) {
		str = `${(error as any).reason}`
	}
	if (error && typeof error === 'object' && (error as any).context) {
		str += `, Context: ${(error as any).context}`
	}

	if (!noStack) {
		if (error && typeof error === 'object' && (error as any).stack) {
			str += ', ' + (error as any).stack
		}
	}

	if (str === '[object Object]') {
		// A last try to make something useful:
		try {
			str = JSON.stringify(error)
			if (str.length > 200) {
				str = str.slice(0, 200) + '...'
			}
		} catch (e) {
			str = '[Error in stringifyError: Failed to stringify]'
		}
	}
	return str
}

/** Returns a string describing the first thing found that makes the two values different.
 * Returns null if no differences are found.
 */
export function diff(a: unknown, b: unknown): string | null {
	const innerDiff = diffInner(a, b)
	if (innerDiff) {
		return (innerDiff[1].length ? `${innerDiff[1].join('.')}: ` : '') + innerDiff[0]
	}
	return null
}
/** Returns [ 'diff explanation', [path] ] */
function diffInner(a: unknown, b: unknown): [string, string[]] | null {
	if (a === b) return null

	if ((a == null || b == null || a == undefined || b == undefined) && a !== b) return [`${a} !== ${b}`, []] // Reduntant, gives nicer output for null & undefined
	if (typeof a !== typeof b) return [`type ${typeof a} !== ${typeof b}`, []]

	if (typeof a === 'object' && typeof b === 'object') {
		if (a === null && b === null) return null
		if (a === null || b === null) return [`${a} !== ${b}`, []]

		if (Array.isArray(a) || Array.isArray(b)) {
			if (!Array.isArray(a) || !Array.isArray(b)) {
				if (Array.isArray(a)) return [`array !== object`, []]
				else return [`object !== array`, []]
			}

			if (a.length !== b.length) return [`length: ${a.length} !== ${b.length}`, []]
		}

		const checkedKeys: { [key: string]: true } = {}
		for (const key of Object.keys(a).concat(Object.keys(b))) {
			if (checkedKeys[key]) continue // already checked this key

			// const innerPath = pathOrg ? `${pathOrg}.${key}` : `${key}`

			// @ts-expect-error keys
			const innerDiff = diffInner(a[key], b[key])
			if (innerDiff) {
				return [innerDiff[0], [key, ...innerDiff[1]]]
			}

			checkedKeys[key] = true
		}

		// if (keys.length !== Object.keys(b).length) return 'different number of keys'
		return null
	}
	return [`${a} !== ${b}`, []]
}
