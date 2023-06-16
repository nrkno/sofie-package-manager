export function removeBasePath(basePath: string, addPath: string): string {
	addPath = addPath.replace(/\\/g, '/')
	basePath = basePath.replace(/\\/g, '/')

	return addPath.replace(new RegExp('^' + escapeRegExp(basePath)), '')
}
function escapeRegExp(text: string): string {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}
export function rebaseUrl(baseUrl: string, relativeUrl: string): string {
	const base = new URL(baseUrl)
	const relative = new URL(baseUrl)
	// relative path may contain URL-unsafe characters, this will encode them but leave any path elements intact
	relative.pathname = relativeUrl
	// at this point, relativeUrl.pathname will already include the leading `/`
	base.pathname = base.pathname + relative.pathname
	base.pathname = base.pathname.replace(/\/{2,}/g, '/') // Remove double slashes
	return base.toString()
}
