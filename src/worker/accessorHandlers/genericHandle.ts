import { AccessorOnPackage } from '@sofie-automation/blueprints-integration'
import { Expectation } from '../expectationApi'

export abstract class GenericAccessorHandle {
	constructor(
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
}
