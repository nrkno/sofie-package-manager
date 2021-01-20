import { AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../expectationApi'
import { GenericWorker } from '../worker'

export abstract class GenericAccessorHandle<Metadata> {
	constructor(
		protected worker: GenericWorker,
		protected _accessor: AccessorOnPackage.Any,
		protected _content: unknown,
		public readonly type: string
	) {}

	/**
	 * Checks if there are any issues with the properties in the accessor or content
	 * Returns a string with error message if something's wrong
	 * Returns undefined if all is OK
	 */
	abstract checkHandleRead(): string | undefined
	abstract checkHandleWrite(): string | undefined
	abstract checkPackageReadAccess(): Promise<string | undefined>
	abstract checkPackageWriteAccess(): Promise<string | undefined>
	abstract checkPackageContainerWriteAccess(): Promise<string | undefined>

	abstract getPackageActualVersion(): Promise<Expectation.Version.Any>

	abstract removePackage(): Promise<void>

	abstract fetchMetadata(): Promise<Metadata | undefined>
	abstract updateMetadata(metadata: Metadata): Promise<void>
	abstract removeMetadata(): Promise<void>
}
