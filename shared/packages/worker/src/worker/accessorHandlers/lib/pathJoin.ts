export function removeBasePath(basePath: string, addPath: string): string {
	addPath = addPath.replace(/\\/g, '/')
	basePath = basePath.replace(/\\/g, '/')

	return addPath.replace(new RegExp('^' + escapeRegExp(basePath)), '')
}
function escapeRegExp(text: string): string {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}
export function joinUrls(...urls: string[]): string {
	return urls.join('/').replace(/\/{2,}/g, '/') // Remove double slashes
}
