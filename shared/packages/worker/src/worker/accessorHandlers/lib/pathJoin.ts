export function removeBasePath(basePath: string, addPath: string) {
	addPath = addPath.replace(/\\/g, '/')
	basePath = basePath.replace(/\\/g, '/')

	return addPath.replace(new RegExp('^' + escapeRegExp(basePath)), '')
}
function escapeRegExp(text: string): string {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}
