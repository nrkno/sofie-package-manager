import crypto from 'crypto'
import path from 'path'
import { compact } from 'underscore'
import { AnyProtectedString } from './ProtectedString'

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
export async function waitTime(duration: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, duration)
	})
}
/** Intercepts a promise and rejects if the promise doesn't resolve in time. */
export async function promiseTimeout<T>(
	p: Promise<T>,
	timeoutTime: number,
	timeoutMessage?: string | ((timeoutDuration: number) => string)
): Promise<T> {
	const timer = startTimer()
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			const duration = timer.get()
			const msg = typeof timeoutMessage === 'function' ? timeoutMessage(duration) : timeoutMessage
			reject(msg || 'Timeout')
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
/**
 * Results in a _true_ type if the provided types are identical.
 * https://github.com/Microsoft/TypeScript/issues/27024#issuecomment-421529650
 */
export type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

/**
 * Results in a _true_ type if the Enum A extends enum B
 * Usage: EnumExtends<typeof A, typeof B>
 */
export type EnumExtends<A, B> = keyof B extends keyof A ? true : false

/** Assert that the values in enum a is present in enum b */
export function assertEnumValuesExtends(
	checkedEnum: { [key: string]: any },
	extendedEnum: { [key: string]: any }
): void {
	for (const key in extendedEnum) {
		if (checkedEnum[key] !== extendedEnum[key]) {
			throw new Error(`${key} is not equal`)
		}
	}
}

/** (Type-check) Assert that the type provided is true. */
// @ts-expect-error T is never used
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function assertTrue<T extends true>(): void {
	// Nothing, this is a type guard only
}

/**
 * Does a deep comparison between two objects, returns the first difference found
 * @param a
 * @param b
 * @param omitKeys (Optional) An array of properties(-paths) to ignore. e.g. ["a", "a.b", "list.1"].
 * 	"*" matches any key, useful for example in arrays: "list.*.ignoreMe"
 * @returns a string describing the first thing found that makes the two values different, null if no differences are found.
 */
export function diff<T>(a: T, b: T, omitKeys?: string[]): string | null {
	let omitKeysMap: { [key: string]: true } | undefined
	if (omitKeys && omitKeys.length) {
		omitKeysMap = {}
		for (const omitKey of omitKeys) {
			omitKeysMap[omitKey] = true
		}
	} else {
		omitKeysMap = undefined
	}

	const innerDiff = diffInner(a, b, omitKeysMap)
	if (innerDiff) {
		return (innerDiff[1].length ? `${innerDiff[1].join('.')}: ` : '') + innerDiff[0]
	}
	return null
}
/** Returns [ 'diff explanation', [path] ] */
function diffInner(
	a: unknown,
	b: unknown,
	omitKeysMap: { [key: string]: true } | undefined
): [string, string[]] | null {
	if (a === b) return null

	if (a == null || b == null || a == undefined || b == undefined) return [`${a} !== ${b}`, []] // Reduntant, gives nicer output for null & undefined

	const typeofA = typeof a
	const typeofB = typeof b
	if (typeofA !== typeofB) return [`type ${typeofA} !== ${typeofB}`, []]

	if (typeofA === 'object' && typeofB === 'object') {
		if (a === null && b === null) return null
		if (a === null || b === null) return [`${a} !== ${b}`, []]

		const isArrayA = Array.isArray(a)
		const isArrayB = Array.isArray(b)
		if (isArrayA || isArrayB) {
			if (!isArrayA || !isArrayB) {
				if (isArrayA) return [`array !== object`, []]
				else return [`object !== array`, []]
			}

			if (a.length !== b.length) return [`length: ${a.length} !== ${b.length}`, []]
		}

		const checkedKeys: { [key: string]: true } = {}
		for (const key of Object.keys(a as any).concat(Object.keys(b as any))) {
			if (checkedKeys[key]) continue // already checked this key
			if (omitKeysMap && omitKeysMap[key]) continue // ignore this key

			// const innerPath = pathOrg ? `${pathOrg}.${key}` : `${key}`

			let omitKeysMapInner: { [key: string]: true } | undefined
			if (omitKeysMap) {
				omitKeysMapInner = {}
				const replaceKey = key + '.'
				for (const omitKey of Object.keys(omitKeysMap)) {
					// "a.b.c" => "b.c"
					if (omitKey.startsWith(replaceKey)) {
						const innerKey = omitKey.slice(replaceKey.length)
						if (innerKey) omitKeysMapInner[innerKey] = true
					} else if (omitKey.startsWith('*.')) {
						const innerKey = omitKey.slice(2)
						if (innerKey) omitKeysMapInner[innerKey] = true
					}
					// else: the key can be omitted
				}
			} else {
				omitKeysMapInner = undefined
			}

			// @ts-expect-error keys
			const innerDiff = diffInner(a[key], b[key], omitKeysMapInner)
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

export function isNodeRunningInDebugMode(): boolean {
	return (
		// @ts-expect-error v8debug is a NodeJS global
		typeof v8debug === 'object' || /--debug|--inspect/.test(process.execArgv.join(' ') + process.env.NODE_OPTIONS)
	)
}

/**
 * Wraps a function, so that multiple calls to it will be grouped together,
 * if the calls are close enough in time so that the resulting promise havent resolved yet.
 * The subsequent calls will resolve with the same result as the first call.
 */
export function deferGets<Args extends any[], Result>(
	fcn: (...args: Args) => Promise<Result>
): (groupId: string | AnyProtectedString, ...args: Args) => Promise<Result> {
	const defers = new Map<
		string | AnyProtectedString,
		{
			resolve: (value: Result) => void
			reject: (err: any) => void
		}[]
	>()

	return async (groupId: string | AnyProtectedString, ...args: Args) => {
		return new Promise<Result>((resolve, reject) => {
			// Check if there already is a call waiting:
			const waiting = defers.get(groupId)
			if (waiting) {
				waiting.push({ resolve, reject })
			} else {
				const newWaiting = [{ resolve, reject }]
				defers.set(groupId, newWaiting)

				fcn(...args)
					.then((result) => {
						defers.delete(groupId)
						for (const w of newWaiting) {
							w.resolve(result)
						}
					})
					.catch((err) => {
						defers.delete(groupId)
						for (const w of newWaiting) {
							w.reject(err)
						}
					})
			}
		})
	}
}
export function ensureArray<T>(v: T | (T | undefined)[]): T[] {
	return compact(Array.isArray(v) ? v : [v])
}
export function first<T>(v: T | (T | undefined)[]): T | undefined {
	return ensureArray(v)[0]
}
/** Shallowly remove undefined properties from an object */
export function removeUndefinedProperties<T extends { [key: string]: unknown } | undefined>(o: T): T {
	if (!o) return o
	if (typeof o !== 'object') return o

	const o2: { [key: string]: unknown } = {}
	for (const [key, value] of Object.entries<unknown>(o)) {
		if (value !== undefined) o2[key] = value
	}
	return o2 as T
}
export function ensureValidValue<T>(value: T, check: (value: any) => boolean, defaultValue: T): T {
	if (check(value)) return value
	return defaultValue
}
/**
 * Convenience method to map entries of a Map.
 * Array.from(myMap.entries()).map(([key, value]) => doSomething(key, value))
 * mapEntries(myMap, (key, value) => doSomething(key, value))
 */
export function mapEntries<K, V, R>(map: Map<K, V>, cb: (key: K, value: V) => R): R[] {
	return Array.from(map.entries()).map(([key, value]) => cb(key, value))
}
/**
 * Convenience method to find() a value in a Map.
 */
export function findValue<K, V>(map: Map<K, V>, cb: (key: K, value: V) => boolean): V | undefined {
	const found = Array.from(map.entries()).find(([key, value]) => cb(key, value))
	if (found === undefined) return undefined
	return found[1]
}
/**
 * Usage:
 * const timer = startTimer()
 * // do stuff
 * const duration = timer.get()
 */
export function startTimer(): {
	/** Returns the duration since the timer started, in milliseconds */
	get: () => number
} {
	const startTime = Date.now()

	return {
		get: () => {
			return Date.now() - startTime
		},
	}
}
/**
 * If the string is longer than maxLength, it will be shortened to maxLength, with '...' in the middle
 */
export function stringMaxLength(str: string, maxLength: number): string {
	str = `${str}`
	if (str.length > maxLength) {
		maxLength = maxLength - 3 // make space for '...'
		const length0 = Math.floor(maxLength / 2)
		const length1 = maxLength - length0

		return str.slice(0, length0) + '...' + str.slice(-length1)
	}
	return str
}
export function mapToObject<T>(map: Map<any, T>): { [key: string]: T } {
	const o: { [key: string]: any } = {}
	map.forEach((value, key) => {
		o[key] = value
	})
	return o
}
/**
 * Like path.join(),
 * but this fixes an issue in path.join where it doesn't handle paths double slashes together with relative paths correctly
 * And it also returns predictable results on both Windows and Linux
 */
export function betterPathJoin(...paths: string[]): string {
	// Replace slashes with the correct path separator, because "C:\\a\\b" is not interpreted correctly on Linux (but C:/a/b is)
	paths = paths.map((p) => p.replace(/[\\/]/g, path.sep))

	let firstPath = paths[0]
	const restPaths = paths.slice(1)

	let prefix = ''
	if (firstPath.startsWith('//') || firstPath.startsWith('\\\\')) {
		// Preserve the prefix, as path.join will remove it:
		prefix = path.sep + path.sep
		firstPath = firstPath.slice(2)
	}

	return prefix + path.join(firstPath, ...restPaths)
}
/**
 * Like path.resolve(),
 * but it returns predictable results on both Windows and Linux
 */
export function betterPathResolve(p: string): string {
	p = p.replace(/[\\/]/g, path.sep)

	// let prefix = ''
	if (p.startsWith('//') || p.startsWith('\\\\')) {
		return path.sep + path.sep + path.normalize(p.slice(2))
	} else {
		return path.resolve(p)
	}
}
/**
 * Like path.isAbsolute(),
 * but it returns same results on both Windows and Linux
 */
export function betterPathIsAbsolute(p: string): boolean {
	return (
		path.isAbsolute(p) ||
		Boolean(p.match(/^\w:/)) || // C:\, path.isAbsolute() doesn't handle this on Linux
		p.startsWith('\\\\') || // \\server\path, path.isAbsolute() doesn't handle this on Linux
		p.startsWith('\\') // \server\path, path.isAbsolute() doesn't handle this on Linux
	)
}

/** Returns true if we're running tests (in Jest) */
export function isRunningInTest(): boolean {
	// Note: JEST_WORKER_ID is set when running in unit tests
	return process.env.JEST_WORKER_ID !== undefined
}
export function isRunningInDevelopment(): boolean {
	return (
		!isRunningInTest() &&
		// Process runs as a node process, we're probably in development mode.:
		(process.execPath.endsWith('node.exe') || // windows
			process.execPath.endsWith('node')) // linux
	)
}
