import { ProtectedString as CoreProtectedString } from '@sofie-automation/shared-lib/dist/lib/protectedString'
export { CoreProtectedString }

/**
 * Defines a string of a certain _type_.
 * The actual values at runtime are the actual string itself,
 * however during compile-time we pretend that all protected strings are prefixed with their type.
 */
export type ProtectedString<Type extends string, Value extends string> = `@@protectedString/${Type}/${Value}`
export type AnyProtectedString = ProtectedString<any, string>

export function protectString<T extends AnyProtectedString>(str: string): T
export function protectString<T extends AnyProtectedString>(str: string | undefined): T | undefined
export function protectString<T extends AnyProtectedString>(str: CoreProtectedString<any>): T
export function protectString<T extends AnyProtectedString>(str: string | null): T | null
export function protectString<T extends AnyProtectedString>(
	str: string | undefined | null | CoreProtectedString<any>
): T | undefined | null {
	return str as any
}
export function unprotectString<T extends AnyProtectedString>(str: T): string
export function unprotectString<T extends AnyProtectedString>(str: T | undefined): string | undefined
export function unprotectString<T extends AnyProtectedString>(str: T | null): string | null
export function unprotectString<T extends AnyProtectedString>(str: T | undefined | null): string | undefined | null {
	return str as any
}
export function isProtectedString(str: unknown): str is AnyProtectedString {
	return typeof str === 'string'
}

/** Like Object.entries() but returns stricter types */
export function objectEntries<T extends AnyProtectedString, V>(obj: Record<T, V>): [T, V][] {
	return Object.entries<V>(obj) as any
}
/** Like Object.keys() but returns stricter types */
export function objectKeys<T extends AnyProtectedString>(obj: Record<T, any>): T[] {
	return Object.keys(obj) as any
}
/** Like Object.values() but returns stricter types */
export function objectValues<V>(obj: Record<AnyProtectedString, V>): V[] {
	return Object.values<V>(obj)
}
/**
 * Like Object.keys().length.
 * Returns the number of keys in an object.
 */
export function objectSize(obj: Record<string, any>): number {
	return Object.keys(obj).length
}

/** Conversion between the old Core ProtectedString and the new one  */
export function convProtectedString<A extends AnyProtectedString, B extends CoreProtectedString<any>>(a: A): B
export function convProtectedString<A extends AnyProtectedString[], B extends CoreProtectedString<any>[]>(a: A): B
export function convProtectedString<A extends AnyProtectedString, B extends CoreProtectedString<any>>(a: B): A
export function convProtectedString<A extends AnyProtectedString[], B extends CoreProtectedString<any>[]>(a: B): A
export function convProtectedString(a: undefined): any {
	return a
}

export function recordToMap<T extends AnyProtectedString, V>(obj: Record<AnyProtectedString, V>): Map<T, V> {
	const m = new Map<T, V>()
	for (const [key, value] of objectEntries<T, V>(obj)) {
		m.set(key, value)
	}
	return m
}
export function mapToRecord<T extends AnyProtectedString, V>(map: Map<T, V>): Record<AnyProtectedString, V> {
	const obj: Record<AnyProtectedString, V> = {}
	for (const [key, value] of map.entries()) {
		obj[key] = value
	}
	return obj
}
