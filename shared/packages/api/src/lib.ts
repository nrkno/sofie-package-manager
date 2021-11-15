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
export function promiseTimeout<T>(p: Promise<T>, timeoutTime: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject('Timeout')
		}, timeoutTime)

		p.then(resolve)
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

	if (!noStack) {
		if (error && typeof error === 'object' && (error as any).stack) {
			str += ', ' + (error as any).stack
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
