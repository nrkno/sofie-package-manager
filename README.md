# Sofie: The Modern TV News Studio Automation System (Package Manager)

This is the "Package Manager" application of the [**Sofie** TV News Studio Automation System](https://github.com/nrkno/Sofie-TV-automation/).

_Note: This is a mono-repo._

## Introduction and Quick Start

See the [Installing Package Manager](https://nrkno.github.io/tv-automation-server-core/docs/getting-started/installation/installing-package-manager) page of the [Sofie System Documentation](https://nrkno.github.io/tv-automation-server-core/) to learn how to get started with Package Manager in a demo environment with CasparCG.

## File structure

This is a mono-repo, all packages resides in [shared/packages](shared/packages) and [apps/](apps/).

The packages in [shared/packages](shared/packages) are helper libraries, used by the packages in [apps/](apps/).

The packages in [apps/](apps/) can be run as individual applications.

The packages in [tests/](tests/) contain unit/integration tests.

### Applications

| Name                  | Location                                                 | Description                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workforce**         | [apps/workforce/app](apps/workforce/app)                 | Mediates connections between the Workers and the Package Managers. _(Later: Will handle spin-up/down of workers according to the current need.)_                                                                                 |
| **Package Manager**   | [apps/package-manager/app](apps/package-manager/app)     | The Package Manager receives `expectedPackages` from a [Sofie Core](https://github.com/nrkno/tv-automation-server-core), converts them into `Expectations`. Keeps track of work statues and distributes the work to the Workers. |
| **Worker**            | [apps/worker/app](apps/worker/app)                       | Executes work orders from the Package Manager                                                                                                                                                                                    |
| **AppContainer-node** | [apps/appcontainer-node/app](apps/appcontainer-node/app) | Spins up/down workers according to the current need. (This appContainer uses child processes, future ones could work with for example Kubernetes or AWS)                                                                         |
| **HTTP-server**       | [apps/http-server/app](apps/http-server/app)             | A simple HTTP server, where files can be uploaded to and served from. (Often used for thumbnails & previews)                                                                                                                     |
| **Single-app**        | [apps/single-app/app](apps/single-app/app)               | Runs one of each of the above in a single application.                                                                                                                                                                           |

### Packages (Libraries)

| Name                   | Location                                                                 | Description                                                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **API**                | [shared/packages/api](shared/packages/api)                               | Various interfaces used by the other libraries                          |
| **ExpectationManager** | [shared/packages/expectationManager](shared/packages/expectationManager) | The ExpectationManager class is used by the Package Manager application |
| **Worker**             | [shared/packages/worker](shared/packages/worker)                         | The Worker class is used by the Worker application                      |
| **Workforce**          | [shared/packages/Workforce](shared/packages/Workforce)                   | The Workforce class is used by the Worker application                   |

## For Developers

Be sure to read the [FOR DEVELOPERS](/FOR_DEVELOPERS.md) documentation.

Note: This mono-repo uses [Yarn](https://yarnpkg.com) and [Lerna](https://github.com/lerna/lerna), so most commands can be run on the root folder (no need to cd into each package).

Examples:

```bash
# Install all dependencies
yarn

# Build all packages
yarn build

# Lint all packages
yarn lint

# Run all tests
yarn test


# Start the single-app (contains all apps)
yarn start:single-app

# (Windows only) Compile all apps into executables, and put into the deploy/ folder.
yarn do:build-win32

# To run a command for a single package, use the --scope option
yarn build --scope @shared/api

# CLI arguments can be passed like so: (note the double -- --)
yarn start:workforce -- -- --port=8080

# Documentation for the CLI agruments
yarn start:workforce -- -- --help

```
