# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.39.0-in-development.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.1...v1.39.0-in-development.0) (2022-01-27)


### Bug Fixes

* A pretty large rehaul of connection logic. ([4b20139](https://github.com/nrkno/tv-automation-package-manager/commit/4b201394c3074b5601ae6c4452129dde2d7318eb))
* bug fix: race condition in messages to Core, that could result in messages being lost ([5a92f26](https://github.com/nrkno/tv-automation-package-manager/commit/5a92f268350b8074b3863c015bb74151e83a4d6c))
* ignore "ExpectedPackages [...] not found"-errors from core. ([3dc51da](https://github.com/nrkno/tv-automation-package-manager/commit/3dc51daad8b2f957bdd8c83f23e54b5f081be742))
* only allow Quantel-GUIDs on a certain form, to filter out any invalid ones ([27f0cad](https://github.com/nrkno/tv-automation-package-manager/commit/27f0cad9a6244d704a8fb292d97f5225684aad15))
* replace terrible hack with a slightly less terrible hack ([65349cc](https://github.com/nrkno/tv-automation-package-manager/commit/65349ccf0c24d92e6b7401d2fe8c8930e924a13e))
* report various execution-times in getStatus ([c03059f](https://github.com/nrkno/tv-automation-package-manager/commit/c03059fdfebe66ce86ab13be99d3f68bbc85f3cc))
* smartbull scan expectation should have high prio ([7a4fbfe](https://github.com/nrkno/tv-automation-package-manager/commit/7a4fbfebc85f63d656f3bccb7aef9eccad2ff814))


### Features

* add CLI argument "--noCore=true" to be used when running without Sofie Core ([1e4b920](https://github.com/nrkno/tv-automation-package-manager/commit/1e4b9203c2df24599c05c07a2566b0bfe207bf14))
* Add the expectationHandler "fileVerify", used to just verify that a file exists, ([adbaf25](https://github.com/nrkno/tv-automation-package-manager/commit/adbaf25177ab6ac7df47199c6be3d1f6de8122ca))





# [1.38.0-in-testing.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0...v1.38.0-in-testing.0) (2021-12-17)


### Bug Fixes

* ignore "ExpectedPackages [...] not found"-errors from core. ([3dc51da](https://github.com/nrkno/tv-automation-package-manager/commit/3dc51daad8b2f957bdd8c83f23e54b5f081be742))





# [1.38.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0...v1.38.0-alpha.0) (2021-12-17)


### Bug Fixes

* ignore "ExpectedPackages [...] not found"-errors from core. ([3dc51da](https://github.com/nrkno/tv-automation-package-manager/commit/3dc51daad8b2f957bdd8c83f23e54b5f081be742))





# [1.37.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.1...v1.37.0) (2021-12-17)


### Bug Fixes

* A pretty large rehaul of connection logic. ([4b20139](https://github.com/nrkno/tv-automation-package-manager/commit/4b201394c3074b5601ae6c4452129dde2d7318eb))
* bug fix: race condition in messages to Core, that could result in messages being lost ([5a92f26](https://github.com/nrkno/tv-automation-package-manager/commit/5a92f268350b8074b3863c015bb74151e83a4d6c))
* report various execution-times in getStatus ([c03059f](https://github.com/nrkno/tv-automation-package-manager/commit/c03059fdfebe66ce86ab13be99d3f68bbc85f3cc))





# [1.37.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.0...v1.37.0-alpha.1) (2021-11-05)


### Bug Fixes

* better handling of when sending statuses to Core fails ([5d5f532](https://github.com/nrkno/tv-automation-package-manager/commit/5d5f532aa9b137bd5fd44489a5ad390b0ce14de9))
* don't try to send updates to core when disconnected, queue them to be sent upon reconnection instead ([1749207](https://github.com/nrkno/tv-automation-package-manager/commit/17492077063b1e9c7805d7813a0b8e571ec3826e))





# [1.37.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.1...v1.37.0-alpha.0) (2021-11-05)


### Bug Fixes

* bug fix: undefined properties could mess with spread operator ([b8bd22b](https://github.com/nrkno/tv-automation-package-manager/commit/b8bd22bb35141a3ad3391a9c4a2b12b805eca447))
* don't generate expectations for packages with no source or target ([b6a45c2](https://github.com/nrkno/tv-automation-package-manager/commit/b6a45c29162be94389213085f98519aca816a45f))
* if a packages shows up multiple times (with different targets), side-effects are only needed for one of them ([2e06d03](https://github.com/nrkno/tv-automation-package-manager/commit/2e06d03442fc54651e421db3518e169502dad4bc))


### Features

* implement Quantel Fileflow Copy expectation ([3844534](https://github.com/nrkno/tv-automation-package-manager/commit/3844534915868afa387fcc06fa55d0e44060bc77))
* refactor Quantel FileFlow to just be a special case within FileCopy [WIP] ([853e7e3](https://github.com/nrkno/tv-automation-package-manager/commit/853e7e39426b2828b3d4922df737fcb2f92e2149))



# [1.1.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0-alpha.0) (2021-09-24)


### Bug Fixes

* add fields to repost status: priority & prevStatusReasons ([e805c61](https://github.com/nrkno/tv-automation-package-manager/commit/e805c61d1b31cf483889dc80f681219e17e89793))
* add method for cleaning out packageContainerPackage statuses upon startup ([d12c163](https://github.com/nrkno/tv-automation-package-manager/commit/d12c1633fc012811ae96b3415f2a9cecd0bbf61c))
* add methods to restart packageContainer monitors ([6dda1bb](https://github.com/nrkno/tv-automation-package-manager/commit/6dda1bb419ca3dc8c30bc8303aa8cf4e20cf1b7f))
* bug fix: non-writeable packageContainers didn't get their statuses reported back to Core ([f906d70](https://github.com/nrkno/tv-automation-package-manager/commit/f906d7077cdd962c1ae69e9409b4604bbbdc5466))


### Features

* change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))





## [1.1.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.0...v1.1.1) (2021-09-30)


### Bug Fixes

* add option to delay removal of PackageInfo ([64af17f](https://github.com/nrkno/tv-automation-package-manager/commit/64af17fb2d30c5231e072afb82b7dafc55295c28))





# [1.1.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0) (2021-09-28)


### Bug Fixes

* add fields to repost status: priority & prevStatusReasons ([e805c61](https://github.com/nrkno/tv-automation-package-manager/commit/e805c61d1b31cf483889dc80f681219e17e89793))
* add method for cleaning out packageContainerPackage statuses upon startup ([d12c163](https://github.com/nrkno/tv-automation-package-manager/commit/d12c1633fc012811ae96b3415f2a9cecd0bbf61c))
* add methods to restart packageContainer monitors ([6dda1bb](https://github.com/nrkno/tv-automation-package-manager/commit/6dda1bb419ca3dc8c30bc8303aa8cf4e20cf1b7f))
* bug fix: non-writeable packageContainers didn't get their statuses reported back to Core ([f906d70](https://github.com/nrkno/tv-automation-package-manager/commit/f906d7077cdd962c1ae69e9409b4604bbbdc5466))
* bug fix: set the priority of the smartbull clip ([b74f239](https://github.com/nrkno/tv-automation-package-manager/commit/b74f239ddafd0494c96669d45a1d12e8746df095))
* clarify priorities ([8351e8b](https://github.com/nrkno/tv-automation-package-manager/commit/8351e8b19cf6629e30f83476876f6ee7cd1fb072))


### Features

* change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))
* back-port release37-features onto release36 ([e2955ec](https://github.com/nrkno/tv-automation-package-manager/commit/e2955ec72a545756c5e270141530c158d27d08e8))





## [1.0.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.1...v1.0.2) (2021-09-15)

**Note:** Version bump only for package @package-manager/generic
