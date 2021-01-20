import { Transform, TransformCallback } from 'stream'

/** Stream transformer that pipes the data and counts the bytes */
export class ByteCounter extends Transform {
	private bytes = 0
	constructor() {
		super()
	}
	// todo: Does this have any performance penalty?
	public _transform(chunk: Buffer, encoding: string, callback: TransformCallback): void {
		this.bytes += chunk.length
		this.emit('progress', this.bytes)
		this.push(chunk, encoding)
		callback()
	}
}
