import fs from 'fs'
import path from 'path'
import ParcelWatcher from '@parcel/watcher'
import { HelpfulEventEmitter, assertNever, stringifyError } from '@sofie-package-manager/api'

export interface FileWatcherEvents {
	/** Emitted whenever there is an error */
	error: (error: string) => void

	/** Emitted whenever a file is created, updated or deleted */
	fileEvent: (event: FileEvent) => void
}
export interface IFileWatcher {
	on<U extends keyof FileWatcherEvents>(event: U, listener: FileWatcherEvents[U]): this
	emit<U extends keyof FileWatcherEvents>(event: U, ...args: Parameters<FileWatcherEvents[U]>): boolean

	/** Start the file watcher */
	init: () => Promise<void>
	/** Stop the file watcher */
	stop: () => Promise<void>
	/** Get the local filepath from the fullPath */
	getLocalFilePath: (fullPath: string) => string | undefined
}

/**
 * The FileWatcher watches a folder for changes to files.
 * It will emit events for files being created, updated or deleted.
 */
export class FileWatcher extends HelpfulEventEmitter implements IFileWatcher {
	private initialized = false
	private delayEmitNewFileTimeoutMap = new Map<string, NodeJS.Timeout>()
	private watcher: ParcelWatcher.AsyncSubscription | undefined = undefined

	constructor(private folderPath: string, private options: Options) {
		super()
		this.addHelpfulEventCheck('fileEvent')
	}
	/**
	 * Initialize the FileWatcher.
	 * While this promise is resolving, the FileWatcher will emit the initial list of files
	 *
	 */
	async init(): Promise<void> {
		if (this.initialized) throw new Error('Already initialized')
		this.initialized = true

		// Get the initial list of files:
		const filePaths = await this.initListAllFiles(this.folderPath)
		this.onFileEvents(
			undefined,
			filePaths.map((filePath) => ({ type: 'create', path: filePath }))
		)

		// Watch for events:
		this.watcher = await ParcelWatcher.subscribe(this.folderPath, this.onFileEvents, this.options)
	}
	async stop(): Promise<void> {
		if (this.watcher) {
			await this.watcher.unsubscribe()
			delete this.watcher
		}
	}
	/** Get the local filepath from the fullPath */
	public getLocalFilePath(fullPath: string): string | undefined {
		return path.relative(this.folderPath, fullPath)
	}

	private onFileEvents = (error: any | undefined, events: ParcelWatcher.Event[]) => {
		if (error) {
			this.emit('error', `Unexpected error event: ${stringifyError(error)}`)
		}

		if (events) {
			for (const event of events) {
				if (event.type === 'create' || event.type === 'update') {
					this.onFileCreatedUpdated(event)
				} else if (event.type === 'delete') {
					this.onFileCreatedDeleted(event)
				} else {
					assertNever(event.type)
				}
			}
		}
	}
	/** Called whenever a file is created or updated */
	private onFileCreatedUpdated(event: ParcelWatcher.Event) {
		const fullPath = event.path

		if (this.options.awaitWriteFinishStabilityThreshold) {
			const waitTime = this.options.awaitWriteFinishStabilityThreshold
			// Delay the emit, to avoid emitting multiple times for the same file while it's updating

			fs.stat(fullPath, (error, stats) => {
				if (error) {
					if (error.code === 'ENOENT') {
						// File doesn't exist anymore, so don't emit
						return
					} else {
						this.emit('error', `Error in fs.stat ${stringifyError(error)}`)
					}
				} else {
					this.checkIfFileIsStable(event, stats.size, waitTime)
				}
			})
		} else {
			this.emit('fileEvent', event)
		}
	}
	/** Called whenever a file is deleted */
	private onFileCreatedDeleted(event: ParcelWatcher.Event) {
		const fullPath = event.path

		// We don't trust the watcher completely, so we'll check it ourselves first..
		// (We've seen an issue where removing a single file from a folder causes chokidar to emit unlink for ALL the files)
		fs.access(fullPath, fs.constants.R_OK, (err) => {
			if (err) {
				// The file truly doesn't exist
				this.delayEmitNewFileTimeoutMap.delete(fullPath)

				const localPath = this.getLocalFilePath(fullPath)
				if (localPath) {
					this.emit('fileEvent', event)
				}
			} else {
				// The file seems to exist, even though chokidar says it doesn't.
				// Ignore the event, then
			}
		})
	}

	/**
	 * List all files recursively in a directory.
	 * This is done initially, to get an initial list of files.
	 */
	private async initListAllFiles(folderPath: string): Promise<string[]> {
		const fileList: string[] = []

		const files = await fs.promises.readdir(folderPath, { withFileTypes: true })

		for (const file of files) {
			const fullPath = path.join(folderPath, file.name)
			if (file.isDirectory()) {
				const innerFileList = await this.initListAllFiles(fullPath)
				for (const innerFile of innerFileList) {
					fileList.push(innerFile)
				}
			} else {
				fileList.push(fullPath)
			}
		}

		return fileList
	}

	/**
	 * Checks if the file is stable, ie hasn't changed its size since last check.
	 * This is useful to avoid emitting multiple times for the same file while it's updating.
	 */
	private checkIfFileIsStable(event: ParcelWatcher.Event, previousSize: number, waitTime: number) {
		const fullPath = event.path

		const previousTimeout = this.delayEmitNewFileTimeoutMap.get(fullPath)
		if (previousTimeout) clearTimeout(previousTimeout)

		this.delayEmitNewFileTimeoutMap.set(
			fullPath,
			setTimeout(() => {
				this.delayEmitNewFileTimeoutMap.delete(fullPath)

				fs.stat(fullPath, (error, stats) => {
					if (error) {
						if (error.code === 'ENOENT') {
							// File doesn't exist anymore, so don't emit
							return
						} else {
							this.emit('error', `Error in fs.stat ${stringifyError(error)}`)
						}
					} else {
						if (stats.size !== previousSize) {
							// Try again later:
							this.checkIfFileIsStable(event, stats.size, waitTime)
						} else {
							this.emit('fileEvent', event)
						}
					}
				})
			}, waitTime)
		)
	}
}

export interface Options {
	ignore?: string[]
	/** If set, will wait for the file being unchanged for the specified duration before considering it [ms] */
	awaitWriteFinishStabilityThreshold?: number | null
}
export interface FileEvent {
	type: 'create' | 'update' | 'delete'
	path: string
}
