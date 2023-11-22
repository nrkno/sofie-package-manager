# Sofie Package Manager

This is the _Package Manager_ application of the [**Sofie** TV Automation System](https://github.com/nrkno/Sofie-TV-automation/).

Package Manager is used by the Sofie system to copy, analyze, and process media files. It is what powers Sofie's ability to copy media files to playout devices, to know when a media file is ready for playout, and to display details about media files in the rundown view such as scene changes, black frames, freeze frames, and more.

## Repository-specific Info for Developers
* [Developer Info](DEVELOPER.md)
* [Contribution Guidelines](CONTRIBUTING.md)

## General Sofie System Info
* [Documentation](https://nrkno.github.io/sofie-core/)
* [Releases](https://nrkno.github.io/sofie-core/releases)

---

## Introduction and Quick Start
See the [Installing Package Manager](https://nrkno.github.io/sofie-core/docs/user-guide/installation/installing-package-manager) page of the Sofie System Documentation to learn how to get started with Package Manager in a demo environment with CasparCG.

## File Structure
This is a monorepo, all packages resides in [shared/packages](shared/packages) and [apps/](apps/).

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

## Notes on Installation

It has been observed a potential issue when running Package Manager as an executable on Windows:
For unknown reasons, there is a buildup of "zombie" TCP sockets over time. It is unknown if this is caused by something in Package Manager or ffmpeg/ffprobe.
As a remedy/hack, [this script](/scripts/clean-up-tcp-sockets.bat) has been useful to avoid potential longterm issues.

## For Developers

Be sure to read the [DEVELOPER](/DEVELOPER.md) documentation.

Note: This monorepo uses [Yarn](https://yarnpkg.com/) and [Lerna](https://github.com/lerna/lerna), so most commands can be run on the root folder (no need to cd into each package).

Initialize Repo:

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

Now you should be good to go. Whenever you do a change, run `yarn build` (or `yarn build:changed` to only build the changed ones) to compile.

Before any code is committed, run these:

```bash
# Lint all packages
yarn lint

# Run all tests
yarn test
```

Other useful commands:

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

_The NRK logo is a registered trademark of Norsk rikskringkasting AS. The license does not grant any right to use, in any way, any trademarks, service marks or logos of Norsk rikskringkasting AS._





