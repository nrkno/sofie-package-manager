# For Developers

Note: This monorepo uses [Yarn](https://yarnpkg.com) and [Lerna](https://github.com/lerna/lerna), so most commands can be run on the root folder (no need to cd into each package).

## Key concepts

![System overview](./images/System-overview.png 'System overview')

### Workforce

_Note: There can be only one(1) Workforce in a setup._

The Workforce keeps track of which `ExpectationManagers` and `Workers` are online, and mediates the contact between the two.
The Workforce is responsible for making sure more `Workers` are spun up (by `AppContainers`) if needed.

### AppContainer

_Note: There can be multiple AppContainers in a setup_

The `AppContainer` is reponsible for spinning up/down `Workers`, and restarting them if they crashes. It allows for having a unified API for several types of computing resources, such as physical computers, Kubernetes clusters (not implemented yet), or some other type of computing cluster.

### Package Manager

_Note: There can be multiple Package Managers in a setup (usually one per Sofie-Core)_

The Package Manager receives [Packages](#packages) from [Sofie Core](https://github.com/nrkno/sofie-core) and generates [Expectations](#expectations) from them.

The [Expectations](#expectations) are then piped into the `ExpectationManager`.

### ExpectationManager

The ExpectationManager keeps track of the current state of the [Expectations](#expectations) (whether they are `NEW`, `WAITING`, `WORKING`, `FULFILLED` etc).

A typical lifetime of an Expectation is:

1. `NEW`: A question is sent out to determine which of the Workers support the type of Expectation at all. Workers check things like "Do I have access to the source and targets at all?".
2. `WAITING`: A Worker is selected to be used for this Expectation. The Worker checks if the Expectation is ready to start working on. A check if the Expectation is already `FULFILLED` is also done here.
3. `READY`: The Worker is asked to start working on the Expectaion.
4. `WORKING`: Intermediary state while the Worker is working.
5. `FULFILLED`: From time-to-time, the Expectation is re-checked if it still is `FULFILLED`

#### Worker

_Note: There can be multiple Workers in a setup_

The Worker is the process which actually does the work.
It exposes an API with methods for the `ExpectationManager` to call in order to check status of Packages and perform the work.

The Worker is (almost completely) **stateless**, which allows it to expose a lambda-like API. This allows for there being a pool of Workers where the workload can be easilly shared between the Workers.

_Future functionality: There are multiple different types of Workers. Some are running on a Windows-machine with direct access to that maching. Some are running in Linux/Docker containers, or even off-premise._

#### ExpectationHandlers & AccessorHandlers

![Expectation and Accessor handlers](./images/handlers.png 'Expectation and Accessor handlers')

Internally, the Worker is structured by separating the `ExpectationHandlers` and the `AccessorHandlers`.

The `ExpectationHandlers` handles the high-level functionality required for a certain Expectation, while the `AccessorHandlers` handles the low-level functionality for a certain Accessor type.

For example, when [copying a file](shared/packages/worker/src/worker/workers/genericWorker/expectationHandlers/fileCopy.ts) from one folder to another, the `ExpectationHandler` will handle things like "check if the source package exists", "check if the target package already exists" but it's never touching the files directly, only talking to the the `AccessorHandler`.
The `AccessorHandler` [exposes a few generic methods](./shared/packages/worker/src/worker/accessorHandlers/genericHandle.ts), like "check if we can read from a Package" (ie does a file exist), etc.

### HTTP Server

The HTTP Server application is a simple HTTP Server which allows for uploading and downloading of Packages with a RESTful API.
It is intended to provide a simple way of serving for example preview-files to the Sofie GUI.

### Single App

The Single App is a special process which runs one of each of the above, all in the same process.
It is intended to be used as a simple deployment and for deveoplemnt/debugging.

### Quantel HTTP Transformer Proxy

This is a small application intended to fix an issue in the Quantel HTTP Transformer, causing streamed content to not work properly.
It works as a proxy http server, pointed at the original Quantel HTTP Transformer.

## Data Structure & Key Concepts

The Package Manager is based on a few key concepts that are intentionally worded to be generic. Instead of calling things "files" or "media", we use the word "Package". The reason behind this is that the Package Manager is indended to be able to handle many different types of "things", stored in a multitude of ways on different types of systems and software/hardware.

### The "Package"

A Package is an abstract "thing". It can be a media-file, a graphics-template, a sound-file, or something else.
The Package is defined by its `content` and `version`.

The **content** of a Package is what defines what the package is "in general". For example, a Media-file might have a file-name, or a publishing id

The **version** of a Package is what defines which actual version a package is. For example, a Media-file might have a "modified date" property, or a version number.

### PackageContainer

A PackageContainer is an "entity that contains/stores Packages". For example: For files on a file-system, the PackageContainer would be a folder.

A PackageContainer is separated from an **Accessor**, which is the "way to access Packages in a PackageContainer". For Example: A folder on a file system, could be accessed locally, via a network-share and perhaps via a HTTP-endpoint.

### Expectation

_See [expectationApi.ts](shared/packages/api/src/expectationApi.ts)._

An Expectation is what the PackageManager uses to figure out what should be done and how to do it. One example is "Copy a file from a source into a target".

## Examples

Below are some examples of the data:

### Example A, a file is to be copied

```javascript
// The input to Package Manager (from Sofie-Core):

const packageContainers = {
	source0: {
		label: 'Source 0',
		accessors: {
			local: {
				type: 'local_folder',
				folderPath: 'D:\\media\\source0',
				allowRead: true,
			},
		},
	},
	target0: {
		label: 'Target 0',
		accessors: {
			local: {
				type: 'local_folder',
				folderPath: 'D:\\media\\target0',
				allowRead: true,
				allowWrite: true,
			},
		},
	},
}
const expectedPackages = [
	{
		type: 'media_file',
		_id: 'test',
		contentVersionHash: 'abc1234',
		content: {
			filePath: 'myFocalFolder\\amb.mp4',
		},
		version: {},
		sources: [
			{
				containerId: 'source0',
				accessors: {
					local: {
						type: 'local_folder',
						filePath: 'amb.mp4',
					},
				},
			},
		],
		layers: ['target0'],
		sideEffect: {
			previewContainerId: null,
			previewPackageSettings: null,
			thumbnailContainerId: null,
			thumbnailPackageSettings: null,
		},
	},
]
```

---

## Initialize Repo

```bash
# install lerna globally
yarn global add lerna

# set up mono-repo
yarn setup

# Install all dependencies
yarn

# Build all packages
yarn build

```

Now you should be good to go.

Whenever you do a change, run `yarn build` (or `yarn build:changed` to only build the changed ones) to compile.

Before any code is committed, run these:

```bash
# Lint all packages
yarn lint

# Run all tests
yarn test
```

## Other Useful Commands

```bash
# Start the single-app (contains all apps)
yarn start:single-app

# Start the single-app in local-only mode, using packages from expectedPackages.json
yarn start:single-app -- -- --watchFiles=true --noCore=true --logLevel=debug



# (Windows only) Compile all apps into executables, and put into the deploy/ folder.
yarn do:build-win32

# To run a command for a single package, use the --scope option
yarn build --scope @sofie-package-manager/api

# CLI arguments can be passed like so: (note the double -- --)
yarn start:workforce -- -- --port=8080

# Documentation for the CLI agruments
yarn start:workforce -- -- --help

```

---
