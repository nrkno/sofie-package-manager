import { WorkerAgentConfig } from './worker'

/** The AppContainer is a host application responsible for spawning other applications */

export interface AppContainerConfig {
	workforceURL: string | null
	appContainerId: string

	resourceId: string
	networkIds: string[]

	windowsDriveLetters: WorkerAgentConfig['windowsDriveLetters']
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace AppContainer {
	export type AppType = 'worker' // | other

	export enum Type {
		NODEJS = 'nodejs',
		// DOCKER = 'docker',
		// KUBERNETES = 'kubernetes',
	}

	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Generic {
		/** Information on how to access the AppContainer */
		export interface AppContainer {
			type: Type
		}

		/** Information about an App running in an AppContainer */
		export interface App {
			/** Uniquely identifies a running instance of an app. */
			appId: string
		}
	}

	/** NodeJS app container */
	// eslint-disable-next-line @typescript-eslint/no-namespace
	export namespace NodeJS {
		export interface AppContainer extends Generic.AppContainer {
			/** URL to the REST interface */
			url: string
		}
		export interface App extends Generic.App {
			type: string // to be better defined later?
		}
	}
}
