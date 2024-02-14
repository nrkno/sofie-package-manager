/**
 * Escape file path with double quotes on Windows.
 * This is to be used when creating process arguments, to avoid issues with spaces in file paths.
 *
 * @param {string} path File path to be escaped.
 * @returns {string} Escaped file path.
 * @see {@link https://ffmpeg.org/ffmpeg-utils.html#Quoting-and-escaping}
 */
export function escapeFilePath(path: string): string {
	return process.platform === 'win32' ? `"${path}"` : path
}
