export async function getEventsSince(_dir: FilePath, _snapshot: FilePath, _opts?: Options): Promise<Event[]> {
	// not implemented
	return []
}
export async function subscribe(_dir: FilePath, _fn: SubscribeCallback, _opts?: Options): Promise<AsyncSubscription> {
	return new AsyncSubscription()
}
export async function unsubscribe(_dir: FilePath, _fn: SubscribeCallback, _opts?: Options): Promise<void> {
	// not implemented
}
export async function writeSnapshot(_dir: FilePath, _snapshot: FilePath, _opts?: Options): Promise<FilePath> {
	// not implemented
	return './mock-snapshot'
}

type FilePath = string
type GlobPattern = string
type BackendType = 'fs-events' | 'watchman' | 'inotify' | 'windows' | 'brute-force'
type EventType = 'create' | 'update' | 'delete'
interface Options {
	ignore?: (FilePath | GlobPattern)[]
	backend?: BackendType
}
type SubscribeCallback = (err: Error | null, events: Event[]) => unknown
interface Event {
	path: FilePath
	type: EventType
}
class AsyncSubscription {
	async unsubscribe(): Promise<void> {
		// not implemented
	}
}
