export function removeBasePath(basePath: string, addPath: string) {
	addPath = addPath.replace(/\\/g, '/')
	basePath = basePath.replace(/\\/g, '/')

	return addPath.replace(new RegExp('^' + escapeRegExp(basePath)), '')
}
function escapeRegExp(text: string): string {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}
export function joinUrls(url0: string, url1: string): string {
	return [
		url0.replace(/\/$/, ''), // trim trailing slash
		url1.replace(/^\//, ''), // trim leading slash
	]
		.join('/')
		.replace(/[^:]\/\//g, '/') // replace double slashes
}
