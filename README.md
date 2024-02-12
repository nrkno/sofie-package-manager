# Sofie Package Manager

This is the _Package Manager_ application of the [**Sofie** TV News Studio Automation System](https://github.com/nrkno/Sofie-TV-automation/).

- [_For Developers_](DEVELOPER.md)

## General Sofie System Information

- [_Sofie_ Documentation](https://nrkno.github.io/sofie-core/)
- [_Sofie_ Releases](https://nrkno.github.io/sofie-core/releases)
- [Contribution Guidelines](CONTRIBUTING.md)
- [License](LICENSE)

---

## Introduction and Quick Start

See the [Installing Package Manager](https://nrkno.github.io/sofie-core/docs/user-guide/installation/installing-package-manager) page of the [Sofie System Documentation](https://nrkno.github.io/sofie-core/) to learn how to get started with Package Manager in a demo environment with CasparCG.

## File Structure

This is a monorepo, all packages resides in [shared/packages](shared/packages) and [apps/](apps/).

The packages in [shared/packages](shared/packages) are helper libraries, used by the packages in [apps/](apps/).

The packages in [apps/](apps/) can be run as individual applications.

The packages in [tests/](tests/) contain unit/integration tests.

### Applications

| Name                  | Location                                                 | Description                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workforce**         | [apps/workforce/app](apps/workforce/app)                 | Mediates connections between the Workers and the Package Managers. _(Later: Will handle spin-up/down of workers according to the current need.)_                                                                  |
| **Package Manager**   | [apps/package-manager/app](apps/package-manager/app)     | The Package Manager receives `expectedPackages` from a [Sofie Core](https://github.com/nrkno/sofie-core), converts them into `Expectations`. Keeps track of work statues and distributes the work to the Workers. |
| **Worker**            | [apps/worker/app](apps/worker/app)                       | Executes work orders from the Package Manager                                                                                                                                                                     |
| **AppContainer-node** | [apps/appcontainer-node/app](apps/appcontainer-node/app) | Spins up/down workers according to the current need. (This appContainer uses child processes, future ones could work with for example Kubernetes or AWS)                                                          |
| **HTTP-server**       | [apps/http-server/app](apps/http-server/app)             | A simple HTTP server, where files can be uploaded to and served from. (Often used for thumbnails & previews)                                                                                                      |
| **Single-app**        | [apps/single-app/app](apps/single-app/app)               | Runs one of each of the above in a single application.                                                                                                                                                            |

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

---

_The NRK logo is a registered trademark of Norsk rikskringkasting AS. The license does not grant any right to use, in any way, any trademarks, service marks or logos of Norsk rikskringkasting AS._
