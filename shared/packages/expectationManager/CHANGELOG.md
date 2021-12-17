# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.38.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0...v1.38.0-alpha.0) (2021-12-17)

**Note:** Version bump only for package @shared/expectation-manager





# [1.37.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.1...v1.37.0) (2021-12-17)


### Bug Fixes

* A pretty large rehaul of connection logic. ([4b20139](https://github.com/nrkno/tv-automation-package-manager/commit/4b201394c3074b5601ae6c4452129dde2d7318eb))
* add "HelpfulEventEmitter" to be used instead ot EventEmitter,, because it'll give the developer a warning if they've forgotten to listen to error events. ([fc1b1db](https://github.com/nrkno/tv-automation-package-manager/commit/fc1b1db8f99abbc35bbd39ba87cee870c3df1885))
* add logging for when closing connections due to ping timeouts, and require two subsequent pings to fail before closing ([48cbc0c](https://github.com/nrkno/tv-automation-package-manager/commit/48cbc0c199c514b5047700e7219165ce7abe283b))
* don't update the PackageOnPackageContainer status in some situations where we don't actually know what state the package actually is in. ([3b41749](https://github.com/nrkno/tv-automation-package-manager/commit/3b417498d8a2518c85cf186154656ca583404cac))
* ExpectationManager: minor updates to expectedPackages (such as priority changes) should not trigger full restarts of expectations ([f7a3de9](https://github.com/nrkno/tv-automation-package-manager/commit/f7a3de9653e679660e6d75b28fcead8473e58805))
* handle unhandled promises ([13a6f5a](https://github.com/nrkno/tv-automation-package-manager/commit/13a6f5a2a7afde41b06538414d517b132e630edb))
* improve how loss-of-connections are handled ([60c74fb](https://github.com/nrkno/tv-automation-package-manager/commit/60c74fbb3e3f7ff43b2caf76d85e3c63c7a44718))
* in init() methods: wait for the 'connected' event being handled before finishing initializing ([b767e0d](https://github.com/nrkno/tv-automation-package-manager/commit/b767e0d4269e379c316a1a62341d0fd1933f9d6e))
* limit the number of times to re-try removing a Package upon fail ([085c1d9](https://github.com/nrkno/tv-automation-package-manager/commit/085c1d90dc4211036a8a4d8bad5d21e5eb103333))
* report various execution-times in getStatus ([c03059f](https://github.com/nrkno/tv-automation-package-manager/commit/c03059fdfebe66ce86ab13be99d3f68bbc85f3cc))





# [1.37.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.0...v1.37.0-alpha.1) (2021-11-05)

**Note:** Version bump only for package @shared/expectation-manager





# [1.37.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.1...v1.37.0-alpha.0) (2021-11-05)


### Bug Fixes

* expedite handling of RESTARTED & REMOVED ([ff6ee72](https://github.com/nrkno/tv-automation-package-manager/commit/ff6ee728bcd68901a4c1560484c602dda4ec73f1))
* improve how REMOVED, ABORTED & RESTARTED states are set ([7326a5f](https://github.com/nrkno/tv-automation-package-manager/commit/7326a5f159fc197a01d23afa7e04080de5cf2403))
* Quantel: handle edge case when title of clip has been changed ([e9d1dca](https://github.com/nrkno/tv-automation-package-manager/commit/e9d1dca9805257357ff5463854614e289e7bd5c6))



# [1.1.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0-alpha.0) (2021-09-24)


### Bug Fixes

* add fields to repost status: priority & prevStatusReasons ([e805c61](https://github.com/nrkno/tv-automation-package-manager/commit/e805c61d1b31cf483889dc80f681219e17e89793))
* add methods to restart packageContainer monitors ([6dda1bb](https://github.com/nrkno/tv-automation-package-manager/commit/6dda1bb419ca3dc8c30bc8303aa8cf4e20cf1b7f))
* also spin up resources based on packageContainers, not just expectations ([3dc6190](https://github.com/nrkno/tv-automation-package-manager/commit/3dc6190e80de494fdbbe08d3f75696f9c1eef7b3))
* bug fix: expectationManager tried to always scale up ([838a51b](https://github.com/nrkno/tv-automation-package-manager/commit/838a51b68aa8c09766c990cbadebca5245353b6f))
* bug fix: non-writeable packageContainers didn't get their statuses reported back to Core ([f906d70](https://github.com/nrkno/tv-automation-package-manager/commit/f906d7077cdd962c1ae69e9409b4604bbbdc5466))
* expectationManager: improve how expectation error-statuses are handled, better querying for available workers etc ([757f853](https://github.com/nrkno/tv-automation-package-manager/commit/757f8538fbd4327e599b499e23d2652102f91964))
* send packageContainerPackage statuses on all statuses ([190c9e5](https://github.com/nrkno/tv-automation-package-manager/commit/190c9e54f09c207fbd8b309f4c1ff29dc328129d))


### Features

* change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))





## [1.1.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.0...v1.1.1) (2021-09-30)

**Note:** Version bump only for package @shared/expectation-manager





# [1.1.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0) (2021-09-28)


### Bug Fixes

* add fields to repost status: priority & prevStatusReasons ([e805c61](https://github.com/nrkno/tv-automation-package-manager/commit/e805c61d1b31cf483889dc80f681219e17e89793))
* add methods to restart packageContainer monitors ([6dda1bb](https://github.com/nrkno/tv-automation-package-manager/commit/6dda1bb419ca3dc8c30bc8303aa8cf4e20cf1b7f))
* also spin up resources based on packageContainers, not just expectations ([3dc6190](https://github.com/nrkno/tv-automation-package-manager/commit/3dc6190e80de494fdbbe08d3f75696f9c1eef7b3))
* bug fix: expectationManager tried to always scale up ([838a51b](https://github.com/nrkno/tv-automation-package-manager/commit/838a51b68aa8c09766c990cbadebca5245353b6f))
* bug fix: non-writeable packageContainers didn't get their statuses reported back to Core ([f906d70](https://github.com/nrkno/tv-automation-package-manager/commit/f906d7077cdd962c1ae69e9409b4604bbbdc5466))
* expectationManager: improve how expectation error-statuses are handled, better querying for available workers etc ([757f853](https://github.com/nrkno/tv-automation-package-manager/commit/757f8538fbd4327e599b499e23d2652102f91964))
* send packageContainerPackage statuses on all statuses ([190c9e5](https://github.com/nrkno/tv-automation-package-manager/commit/190c9e54f09c207fbd8b309f4c1ff29dc328129d))
* better handling of timed out jobs ([82bb9fc](https://github.com/nrkno/tv-automation-package-manager/commit/82bb9fc40f95636d6352a563f0d21fbcff59556e))


### Features

* change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))
* back-port release37-features onto release36 ([e2955ec](https://github.com/nrkno/tv-automation-package-manager/commit/e2955ec72a545756c5e270141530c158d27d08e8))





## [1.0.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.1...v1.0.2) (2021-09-15)

**Note:** Version bump only for package @shared/expectation-manager
