# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.37.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.0...v1.37.0-alpha.1) (2021-11-05)


### Bug Fixes

* better handling of when sending statuses to Core fails ([5d5f532](https://github.com/nrkno/tv-automation-package-manager/commit/5d5f532aa9b137bd5fd44489a5ad390b0ce14de9))
* don't try to send updates to core when disconnected, queue them to be sent upon reconnection instead ([1749207](https://github.com/nrkno/tv-automation-package-manager/commit/17492077063b1e9c7805d7813a0b8e571ec3826e))





# [1.37.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.1...v1.37.0-alpha.0) (2021-11-05)


### Bug Fixes

* add CLI option to multiply worker cost ([3d4f131](https://github.com/nrkno/tv-automation-package-manager/commit/3d4f131c099d0f2c799016929148930f938ce603))
* add workforcePort CLI option for singleApp ([aba69cb](https://github.com/nrkno/tv-automation-package-manager/commit/aba69cb4998cd92ad8b88316c79a1f99a6e266b4))
* bug fix: quantel clone by title didn't work at all ([b502862](https://github.com/nrkno/tv-automation-package-manager/commit/b502862de54cc7b9510e671220ded2127881a5cf))
* bug fix: undefined properties could mess with spread operator ([b8bd22b](https://github.com/nrkno/tv-automation-package-manager/commit/b8bd22bb35141a3ad3391a9c4a2b12b805eca447))
* check for status change while ABORTING ([b36c6e0](https://github.com/nrkno/tv-automation-package-manager/commit/b36c6e0ea7cc61b6de5d72d1868c66e95c5b6488))
* check if fileflowURL is set on accessor when selecting the best accessor ([abca120](https://github.com/nrkno/tv-automation-package-manager/commit/abca120658b7f4b849a487c8d8aa2f7ae8e816c0))
* disable drive mapping when using FileFlow ([7800b82](https://github.com/nrkno/tv-automation-package-manager/commit/7800b826f662a7fe9e558ac36c14deadd428bef9))
* don't generate expectations for packages with no source or target ([b6a45c2](https://github.com/nrkno/tv-automation-package-manager/commit/b6a45c29162be94389213085f98519aca816a45f))
* expedite handling of RESTARTED & REMOVED ([ff6ee72](https://github.com/nrkno/tv-automation-package-manager/commit/ff6ee728bcd68901a4c1560484c602dda4ec73f1))
* Fileflow exports correctly created ([b1f8547](https://github.com/nrkno/tv-automation-package-manager/commit/b1f85473ef0d8ce126e12b5a153f6349227128c7))
* fileflow only supports Quantel to File_Share ([a79664d](https://github.com/nrkno/tv-automation-package-manager/commit/a79664d9a46a3ca868cc23685de50b9fc79ec71b))
* guid / title may be set in Quantel Accessor ([98dcb53](https://github.com/nrkno/tv-automation-package-manager/commit/98dcb539dfb7c4c1a4a0340c5833f491fced3ab4))
* if a packages shows up multiple times (with different targets), side-effects are only needed for one of them ([2e06d03](https://github.com/nrkno/tv-automation-package-manager/commit/2e06d03442fc54651e421db3518e169502dad4bc))
* improve how REMOVED, ABORTED & RESTARTED states are set ([7326a5f](https://github.com/nrkno/tv-automation-package-manager/commit/7326a5f159fc197a01d23afa7e04080de5cf2403))
* improve logging for requestResources methods ([8dd3b62](https://github.com/nrkno/tv-automation-package-manager/commit/8dd3b6246dbdedafcec99931edb9a2d776b9f61a))
* listen to errors from Koa ([6f2cd1d](https://github.com/nrkno/tv-automation-package-manager/commit/6f2cd1d61cb09eb26fd93738d51b4d8e2e03b856))
* more forgiving comparison of resource/network ids ([e3041df](https://github.com/nrkno/tv-automation-package-manager/commit/e3041df8741ed528263beddc7663eae3c068f7c5))
* Quantel: handle edge case when title of clip has been changed ([e9d1dca](https://github.com/nrkno/tv-automation-package-manager/commit/e9d1dca9805257357ff5463854614e289e7bd5c6))
* refactor and fix: use guid & title from content or accessor interchangeably ([171b396](https://github.com/nrkno/tv-automation-package-manager/commit/171b3963a149ec0e7288c726f695ab28f7e33420))


### Features

* add fileflow profile support for Quantel Fileflow copy ([38cfbfa](https://github.com/nrkno/tv-automation-package-manager/commit/38cfbfa3402ac3a80e1c9efc5e70ae20243ecc7e))
* implement Quantel Fileflow Copy expectation ([3844534](https://github.com/nrkno/tv-automation-package-manager/commit/3844534915868afa387fcc06fa55d0e44060bc77))
* refactor Quantel FileFlow to just be a special case within FileCopy [WIP] ([853e7e3](https://github.com/nrkno/tv-automation-package-manager/commit/853e7e39426b2828b3d4922df737fcb2f92e2149))



# [1.1.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0-alpha.0) (2021-09-24)


### Bug Fixes

* add fields to repost status: priority & prevStatusReasons ([e805c61](https://github.com/nrkno/tv-automation-package-manager/commit/e805c61d1b31cf483889dc80f681219e17e89793))
* add method for cleaning out packageContainerPackage statuses upon startup ([d12c163](https://github.com/nrkno/tv-automation-package-manager/commit/d12c1633fc012811ae96b3415f2a9cecd0bbf61c))
* add methods to restart packageContainer monitors ([6dda1bb](https://github.com/nrkno/tv-automation-package-manager/commit/6dda1bb419ca3dc8c30bc8303aa8cf4e20cf1b7f))
* also spin up resources based on packageContainers, not just expectations ([3dc6190](https://github.com/nrkno/tv-automation-package-manager/commit/3dc6190e80de494fdbbe08d3f75696f9c1eef7b3))
* bug fix: expectationManager tried to always scale up ([838a51b](https://github.com/nrkno/tv-automation-package-manager/commit/838a51b68aa8c09766c990cbadebca5245353b6f))
* bug fix: non-writeable packageContainers didn't get their statuses reported back to Core ([f906d70](https://github.com/nrkno/tv-automation-package-manager/commit/f906d7077cdd962c1ae69e9409b4604bbbdc5466))
* expectationManager: improve how expectation error-statuses are handled, better querying for available workers etc ([757f853](https://github.com/nrkno/tv-automation-package-manager/commit/757f8538fbd4327e599b499e23d2652102f91964))
* send packageContainerPackage statuses on all statuses ([190c9e5](https://github.com/nrkno/tv-automation-package-manager/commit/190c9e54f09c207fbd8b309f4c1ff29dc328129d))


### Features

* change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))





## [1.1.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.0...v1.1.1) (2021-09-30)

### Bug Fixes

- add fields to repost status: priority & prevStatusReasons ([e805c61](https://github.com/nrkno/tv-automation-package-manager/commit/e805c61d1b31cf483889dc80f681219e17e89793))
- add method for cleaning out packageContainerPackage statuses upon startup ([d12c163](https://github.com/nrkno/tv-automation-package-manager/commit/d12c1633fc012811ae96b3415f2a9cecd0bbf61c))
- add methods to restart packageContainer monitors ([6dda1bb](https://github.com/nrkno/tv-automation-package-manager/commit/6dda1bb419ca3dc8c30bc8303aa8cf4e20cf1b7f))
- also spin up resources based on packageContainers, not just expectations ([3dc6190](https://github.com/nrkno/tv-automation-package-manager/commit/3dc6190e80de494fdbbe08d3f75696f9c1eef7b3))
- bug fix: expectationManager tried to always scale up ([838a51b](https://github.com/nrkno/tv-automation-package-manager/commit/838a51b68aa8c09766c990cbadebca5245353b6f))
- bug fix: non-writeable packageContainers didn't get their statuses reported back to Core ([f906d70](https://github.com/nrkno/tv-automation-package-manager/commit/f906d7077cdd962c1ae69e9409b4604bbbdc5466))
- bug fix: set the priority of the smartbull clip ([b74f239](https://github.com/nrkno/tv-automation-package-manager/commit/b74f239ddafd0494c96669d45a1d12e8746df095))
- clarify priorities ([8351e8b](https://github.com/nrkno/tv-automation-package-manager/commit/8351e8b19cf6629e30f83476876f6ee7cd1fb072))
- expectationManager: improve how expectation error-statuses are handled, better querying for available workers etc ([757f853](https://github.com/nrkno/tv-automation-package-manager/commit/757f8538fbd4327e599b499e23d2652102f91964))
- send packageContainerPackage statuses on all statuses ([190c9e5](https://github.com/nrkno/tv-automation-package-manager/commit/190c9e54f09c207fbd8b309f4c1ff29dc328129d))
- add option to delay removal of PackageInfo ([64af17f](https://github.com/nrkno/tv-automation-package-manager/commit/64af17fb2d30c5231e072afb82b7dafc55295c28))

# [1.1.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0) (2021-09-28)

### Bug Fixes

- better handling of timed out jobs ([82bb9fc](https://github.com/nrkno/tv-automation-package-manager/commit/82bb9fc40f95636d6352a563f0d21fbcff59556e))
- bug fix: set the priority of the smartbull clip ([b74f239](https://github.com/nrkno/tv-automation-package-manager/commit/b74f239ddafd0494c96669d45a1d12e8746df095))
- clarify priorities ([8351e8b](https://github.com/nrkno/tv-automation-package-manager/commit/8351e8b19cf6629e30f83476876f6ee7cd1fb072))

### Features

- change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))
- back-port release37-features onto release36 ([e2955ec](https://github.com/nrkno/tv-automation-package-manager/commit/e2955ec72a545756c5e270141530c158d27d08e8))

## [1.0.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.1...v1.0.2) (2021-09-15)

### Bug Fixes

- all handlers that handle http_proxy should also be able to handle http ([feac6d7](https://github.com/nrkno/tv-automation-package-manager/commit/feac6d7dc03817f8ce01594ef2070c7bcb955834))
- previews should support the source-types file-share and http_proxy ([982ff4f](https://github.com/nrkno/tv-automation-package-manager/commit/982ff4f396be8a676a1498c5241ac912a7e3afb7))
