export function mapToObject<T>(map: Map<any, T>): { [key: string]: T } {
	const o: { [key: string]: any } = {}
	map.forEach((value, key) => {
		o[key] = value
	})
	return o
}
