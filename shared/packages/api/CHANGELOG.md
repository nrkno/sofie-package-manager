# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.43.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.43.1...v1.43.2) (2024-02-19)

**Note:** Version bump only for package @sofie-package-manager/api





# [1.43.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.43.0-alpha.2...v1.43.0) (2024-01-11)

**Note:** Version bump only for package @sofie-package-manager/api





# [1.43.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.2...v1.43.0-alpha.0) (2023-11-30)


### Features

* make json data copy work ([ba050d5](https://github.com/nrkno/tv-automation-package-manager/commit/ba050d504d28584c0d7085bfac78a0afc025ecb2))





## [1.42.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.1...v1.42.2) (2023-10-12)


### Bug Fixes

* add new option `warningLimit` to monitor. ([a50b1a2](https://github.com/nrkno/tv-automation-package-manager/commit/a50b1a225719e78d1fd7471d9c183f1af888042d))
* improve debug logging, add CLI argument: --logLevel=debug ([52043c0](https://github.com/nrkno/tv-automation-package-manager/commit/52043c03fd924f33c88e7e4771826e8e2ff435e5))
* replace chokidar file monitor with ParcelWatcher ([60922e4](https://github.com/nrkno/tv-automation-package-manager/commit/60922e403c60739c5360b61d932b526b98c70ef3))





## [1.42.1](https://github.com/nrkno/sofie-package-manager/compare/v1.42.1-alpha.4...v1.42.1) (2023-06-19)

**Note:** Version bump only for package @sofie-package-manager/api





## [1.42.1-alpha.0](https://github.com/nrkno/sofie-package-manager/compare/v1.42.0...v1.42.1-alpha.0) (2023-06-09)


### Bug Fixes

* URL handling was broken, because it treated URLs as file paths ([827a939](https://github.com/nrkno/sofie-package-manager/commit/827a93961e9647927aef7970af8babbab028a29e))





# [1.42.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.5...v1.42.0) (2023-05-10)

**Note:** Version bump only for package @sofie-package-manager/api





# [1.42.0-alpha.4](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.3...v1.42.0-alpha.4) (2023-05-03)

**Note:** Version bump only for package @sofie-package-manager/api





# [1.42.0-alpha.3](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.2...v1.42.0-alpha.3) (2023-05-03)

**Note:** Version bump only for package @sofie-package-manager/api





# [1.42.0-alpha.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.1...v1.42.0-alpha.2) (2023-05-03)


### Bug Fixes

* add `removePackageOnUnFulfill` workOption. Used to remove the package upon an unfulfillment of expectation ([fbc9be5](https://github.com/nrkno/tv-automation-package-manager/commit/fbc9be53897a88e054265e690daf5f069f41e161))
* change default log-level to be 'verbose' ([3255e75](https://github.com/nrkno/tv-automation-package-manager/commit/3255e755c10a246d14ffcec0f34622fa52e73900))
* unfullfill dependent expectations when the expectation-dependee unfullfills ([b5f7dda](https://github.com/nrkno/tv-automation-package-manager/commit/b5f7dda2dd1df8ccf0b2ca47adb3ebe3c921e40c))





# [1.42.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-0...v1.42.0-alpha.0) (2023-04-26)


### Features

* implement test ([afcd0b5](https://github.com/nrkno/tv-automation-package-manager/commit/afcd0b552f6bb66079c64162fc6f40c7f702b139))
* support failure in ffmpeg due to referencing a non-existant channel ([bf4888d](https://github.com/nrkno/tv-automation-package-manager/commit/bf4888d1d5525b3a4ee28f8b7e60e54c16c439a7))
* **Loudness:** Generate loduness scan of packages ([6e990d7](https://github.com/nrkno/tv-automation-package-manager/commit/6e990d7d8910cfd887317d69feb48a3a7e151589))


### Reverts

* Revert "chore: split out "@sofie-package-manager/input-api" to a separate package" ([8df7c18](https://github.com/nrkno/tv-automation-package-manager/commit/8df7c183d86436540b4e4b5489446d6340188b24))





# [1.42.0-0](https://github.com/nrkno/sofie-package-manager/compare/v1.41.1...v1.42.0-0) (2023-03-22)


### Features

* Package manager placeholder ([47d2e1f](https://github.com/nrkno/sofie-package-manager/commit/47d2e1f64ffe90fe7a5fe967e83bca0befb66471))
* update server-core-integration to r49 ([08971cd](https://github.com/nrkno/sofie-package-manager/commit/08971cdfdec18550afc06d0c5f043b7dd3af3e0f))





## [1.41.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.41.0...v1.41.1) (2023-02-22)


### Bug Fixes

* adjust MESSAGE_TIMEOUT during unit tests ([2411472](https://github.com/nrkno/tv-automation-package-manager/commit/2411472811f39835985d3d86c7950d12be077b5c))





# [1.41.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.41.0-alpha.1...v1.41.0) (2023-02-03)

**Note:** Version bump only for package @sofie-package-manager/api





# [1.41.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.41.0-alpha.0...v1.41.0-alpha.1) (2023-02-03)


### Bug Fixes

* bug with logLevels ([115651b](https://github.com/nrkno/tv-automation-package-manager/commit/115651b5a4a1b2b33de3887a2971f76e2b2abe11))





# [1.41.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.40.2...v1.41.0-alpha.0) (2023-01-27)


### Features

* **lib:** add ensureValidValue ([e7e19af](https://github.com/nrkno/tv-automation-package-manager/commit/e7e19af65333ac0a4ecb72011a5960f0e41ba1a4))





## [1.40.1](https://github.com/nrkno/sofie-package-manager/compare/v1.40.0...v1.40.1) (2023-01-26)

**Note:** Version bump only for package @sofie-package-manager/api





# [1.40.0](https://github.com/nrkno/sofie-package-manager/compare/v1.39.8-alpha.4...v1.40.0) (2023-01-23)


### Bug Fixes

* remove dependency on blueprints-integration ([e545992](https://github.com/nrkno/sofie-package-manager/commit/e545992e5204ff836e86011edeee7c08fdcaeaff))


### Features

* export stateReevaluationConcurrency as concurrencty config arguement ([3eabd63](https://github.com/nrkno/sofie-package-manager/commit/3eabd638d678e3c3761b6dbdd312802fd2f64e3b))





## [1.39.8-alpha.4](https://github.com/nrkno/sofie-package-manager/compare/v1.39.8-alpha.3...v1.39.8-alpha.4) (2023-01-17)

**Note:** Version bump only for package @sofie-package-manager/api





## [1.39.8-alpha.0](https://github.com/nrkno/sofie-package-manager/compare/v1.39.7...v1.39.8-alpha.0) (2023-01-12)


### Bug Fixes

* add timestamp to production logs ([9deb2a3](https://github.com/nrkno/sofie-package-manager/commit/9deb2a3a3ce12ddaee704e72caccd5d0763e859a))





# [1.39.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.0-in-development.1...v1.39.0) (2022-09-07)


### Bug Fixes

* add option for singleApp to not spin up the http-servers ([1ca7588](https://github.com/nrkno/tv-automation-package-manager/commit/1ca75888819b52ac188e8b7c451556cd78d3d4bd))
* add WorkerStorage to AppContainer, to be used for storing data from workers ([19a1516](https://github.com/nrkno/tv-automation-package-manager/commit/19a15166c9fece12d8474227c4ac0833c115632d))
* better logging of unhandled promises / warnings ([c4be2c6](https://github.com/nrkno/tv-automation-package-manager/commit/c4be2c677822b1f44ffff10f6bfccd6ff429b404))
* DataStorage: add custom timeout duration for write locks ([32d993d](https://github.com/nrkno/tv-automation-package-manager/commit/32d993d8025c4b2b300f35fd437e1339bc0d497f))
* FileShare: fast-path to avoid a timeout issue when many read/write-calls are queued at the same time ([cfe389c](https://github.com/nrkno/tv-automation-package-manager/commit/cfe389c09e31c50c982e590c20741d986b0cd09f))
* Implement a "chaos monkey" that cuts connections between the processes. This is to ensure that reconnections works as they should. ([45b05af](https://github.com/nrkno/tv-automation-package-manager/commit/45b05afde8fc9a755bee9f15385f8f7b59360e2d))
* improve logging, adding categories for logger to make it easier to know where a lig line comes from ([db18a35](https://github.com/nrkno/tv-automation-package-manager/commit/db18a35e841169f0ace1b3d42db2b9932c15f88d))
* Quantel-scans should use the original, not the temporary storage ([149e6d8](https://github.com/nrkno/tv-automation-package-manager/commit/149e6d8790b4c1db84a4514b01fb57dfdb78a51b))


### Features

* add APPCONTAINER_MAX_KEEPALIVE ([bd75dd8](https://github.com/nrkno/tv-automation-package-manager/commit/bd75dd8e845e4f5137793b36aacbe4e4f17d4dd3))
* add CLI option: considerCPULoad ([6da6ab0](https://github.com/nrkno/tv-automation-package-manager/commit/6da6ab0beab48fb59d29b3fcbfc6a3d0e4aa5de4))
* Apply a rate-limit to the Quantel-http-transformer proxy, to avoid DOS-ing the backend servers ([29a09cf](https://github.com/nrkno/tv-automation-package-manager/commit/29a09cf233bc524d2bf3e52f9d21ceb680363290))
* support for "temporary-storage"; by copying packages to a local PackageContainer, scanning, preview-generation etc can be done quicker. ([31513f3](https://github.com/nrkno/tv-automation-package-manager/commit/31513f3b2b46054c57c8ff6110abd7285d8983c6))





# [1.39.0-in-development.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.0-in-development.0...v1.39.0-in-development.1) (2022-02-15)

### Bug Fixes

- Don't mark "waiting for orher Expectation" as an error ([2b6413c](https://github.com/nrkno/tv-automation-package-manager/commit/2b6413cfed1eeb97779ca0853329d368dd10f766))
- report status of Package Manager to Core ([4679e08](https://github.com/nrkno/tv-automation-package-manager/commit/4679e08b70fd917ae4e059e22f4b82a48e2491b5))

# [1.39.0-in-development.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.1...v1.39.0-in-development.0) (2022-01-27)

### Bug Fixes

- A pretty large rehaul of connection logic. ([4b20139](https://github.com/nrkno/tv-automation-package-manager/commit/4b201394c3074b5601ae6c4452129dde2d7318eb))
- add "HelpfulEventEmitter" to be used instead ot EventEmitter,, because it'll give the developer a warning if they've forgotten to listen to error events. ([fc1b1db](https://github.com/nrkno/tv-automation-package-manager/commit/fc1b1db8f99abbc35bbd39ba87cee870c3df1885))
- add logging for when closing connections due to ping timeouts, and require two subsequent pings to fail before closing ([48cbc0c](https://github.com/nrkno/tv-automation-package-manager/commit/48cbc0c199c514b5047700e7219165ce7abe283b))
- fix of potential bug where a throw might not be caught ([0dc2753](https://github.com/nrkno/tv-automation-package-manager/commit/0dc2753c0c17d5dc3de3c56315b46c9c01c350b8))
- handle unhandled promises ([13a6f5a](https://github.com/nrkno/tv-automation-package-manager/commit/13a6f5a2a7afde41b06538414d517b132e630edb))
- improve how loss-of-connections are handled ([60c74fb](https://github.com/nrkno/tv-automation-package-manager/commit/60c74fbb3e3f7ff43b2caf76d85e3c63c7a44718))
- improve stringifyError, to avoid "Error: [object Object]" in logs ([9c9e888](https://github.com/nrkno/tv-automation-package-manager/commit/9c9e88874081b757be3684c7a5604b04e5496ad4))
- in init() methods: wait for the 'connected' event being handled before finishing initializing ([b767e0d](https://github.com/nrkno/tv-automation-package-manager/commit/b767e0d4269e379c316a1a62341d0fd1933f9d6e))
- re-export blueprint-integration exports in @sofie-package-manager/api inputApi.ts ([803adc5](https://github.com/nrkno/tv-automation-package-manager/commit/803adc5affbc38c404e710ae1f539907f7717fba))
- receivers will not time out if their methods are unresponsive. ([b08c9ac](https://github.com/nrkno/tv-automation-package-manager/commit/b08c9ac39885d4a26bbdb5f28b3f4785878cb977))
- report various execution-times in getStatus ([c03059f](https://github.com/nrkno/tv-automation-package-manager/commit/c03059fdfebe66ce86ab13be99d3f68bbc85f3cc))
- time out http-fetches properly, to avoid ugly timed out action errors ([a6fee11](https://github.com/nrkno/tv-automation-package-manager/commit/a6fee113d59a5b666f05977225d4a55a6f9e5b09))
- type fix ([092d368](https://github.com/nrkno/tv-automation-package-manager/commit/092d36836af3a600c5d097aea615a1140138566f))
- WebsocketServer: track, emit and log 'error' and 'close' events ([e3ba67f](https://github.com/nrkno/tv-automation-package-manager/commit/e3ba67fc26720809e0b33814be49e50e56e4d348))
- **adapterClient:** add an explicit timeout for websocket function invocations ([bbc3903](https://github.com/nrkno/tv-automation-package-manager/commit/bbc39032d91e75158c8469d5579b2d199d98efc5))

### Features

- add CLI argument "--noCore=true" to be used when running without Sofie Core ([1e4b920](https://github.com/nrkno/tv-automation-package-manager/commit/1e4b9203c2df24599c05c07a2566b0bfe207bf14))
- add support for uploading packages to ATEM video switchers ([798ee85](https://github.com/nrkno/tv-automation-package-manager/commit/798ee85e23d4ef9c8cd539ffd17e4bc6a439017b))
- Add the expectationHandler "fileVerify", used to just verify that a file exists, ([adbaf25](https://github.com/nrkno/tv-automation-package-manager/commit/adbaf25177ab6ac7df47199c6be3d1f6de8122ca))

# [1.38.0-in-testing.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0...v1.38.0-in-testing.0) (2021-12-17)

### Bug Fixes

- re-export blueprint-integration exports in @sofie-package-manager/api inputApi.ts ([803adc5](https://github.com/nrkno/tv-automation-package-manager/commit/803adc5affbc38c404e710ae1f539907f7717fba))

# [1.38.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0...v1.38.0-alpha.0) (2021-12-17)

### Bug Fixes

- re-export blueprint-integration exports in @sofie-package-manager/api inputApi.ts ([803adc5](https://github.com/nrkno/tv-automation-package-manager/commit/803adc5affbc38c404e710ae1f539907f7717fba))

# [1.37.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.1...v1.37.0) (2021-12-17)

### Bug Fixes

- A pretty large rehaul of connection logic. ([4b20139](https://github.com/nrkno/tv-automation-package-manager/commit/4b201394c3074b5601ae6c4452129dde2d7318eb))
- add "HelpfulEventEmitter" to be used instead ot EventEmitter,, because it'll give the developer a warning if they've forgotten to listen to error events. ([fc1b1db](https://github.com/nrkno/tv-automation-package-manager/commit/fc1b1db8f99abbc35bbd39ba87cee870c3df1885))
- add logging for when closing connections due to ping timeouts, and require two subsequent pings to fail before closing ([48cbc0c](https://github.com/nrkno/tv-automation-package-manager/commit/48cbc0c199c514b5047700e7219165ce7abe283b))
- fix of potential bug where a throw might not be caught ([0dc2753](https://github.com/nrkno/tv-automation-package-manager/commit/0dc2753c0c17d5dc3de3c56315b46c9c01c350b8))
- handle unhandled promises ([13a6f5a](https://github.com/nrkno/tv-automation-package-manager/commit/13a6f5a2a7afde41b06538414d517b132e630edb))
- improve how loss-of-connections are handled ([60c74fb](https://github.com/nrkno/tv-automation-package-manager/commit/60c74fbb3e3f7ff43b2caf76d85e3c63c7a44718))
- improve stringifyError, to avoid "Error: [object Object]" in logs ([9c9e888](https://github.com/nrkno/tv-automation-package-manager/commit/9c9e88874081b757be3684c7a5604b04e5496ad4))
- in init() methods: wait for the 'connected' event being handled before finishing initializing ([b767e0d](https://github.com/nrkno/tv-automation-package-manager/commit/b767e0d4269e379c316a1a62341d0fd1933f9d6e))
- receivers will not time out if their methods are unresponsive. ([b08c9ac](https://github.com/nrkno/tv-automation-package-manager/commit/b08c9ac39885d4a26bbdb5f28b3f4785878cb977))
- report various execution-times in getStatus ([c03059f](https://github.com/nrkno/tv-automation-package-manager/commit/c03059fdfebe66ce86ab13be99d3f68bbc85f3cc))
- type fix ([092d368](https://github.com/nrkno/tv-automation-package-manager/commit/092d36836af3a600c5d097aea615a1140138566f))
- WebsocketServer: track, emit and log 'error' and 'close' events ([e3ba67f](https://github.com/nrkno/tv-automation-package-manager/commit/e3ba67fc26720809e0b33814be49e50e56e4d348))

# [1.37.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.0...v1.37.0-alpha.1) (2021-11-05)

**Note:** Version bump only for package @sofie-package-manager/api

# [1.37.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.1...v1.37.0-alpha.0) (2021-11-05)

### Bug Fixes

- add CLI option to multiply worker cost ([3d4f131](https://github.com/nrkno/tv-automation-package-manager/commit/3d4f131c099d0f2c799016929148930f938ce603))
- add workforcePort CLI option for singleApp ([aba69cb](https://github.com/nrkno/tv-automation-package-manager/commit/aba69cb4998cd92ad8b88316c79a1f99a6e266b4))
- improve logging for requestResources methods ([8dd3b62](https://github.com/nrkno/tv-automation-package-manager/commit/8dd3b6246dbdedafcec99931edb9a2d776b9f61a))

### Features

- implement Quantel Fileflow Copy expectation ([3844534](https://github.com/nrkno/tv-automation-package-manager/commit/3844534915868afa387fcc06fa55d0e44060bc77))
- refactor Quantel FileFlow to just be a special case within FileCopy [WIP] ([853e7e3](https://github.com/nrkno/tv-automation-package-manager/commit/853e7e39426b2828b3d4922df737fcb2f92e2149))

# [1.1.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0-alpha.0) (2021-09-24)

### Bug Fixes

- also spin up resources based on packageContainers, not just expectations ([3dc6190](https://github.com/nrkno/tv-automation-package-manager/commit/3dc6190e80de494fdbbe08d3f75696f9c1eef7b3))

### Features

- change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))

## [1.1.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.0...v1.1.1) (2021-09-30)

### Bug Fixes

- also spin up resources based on packageContainers, not just expectations ([3dc6190](https://github.com/nrkno/tv-automation-package-manager/commit/3dc6190e80de494fdbbe08d3f75696f9c1eef7b3))
- add option to delay removal of PackageInfo ([64af17f](https://github.com/nrkno/tv-automation-package-manager/commit/64af17fb2d30c5231e072afb82b7dafc55295c28))

# [1.1.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.2...v1.1.0) (2021-09-28)

### Bug Fixes

- better handling of timed out jobs ([82bb9fc](https://github.com/nrkno/tv-automation-package-manager/commit/82bb9fc40f95636d6352a563f0d21fbcff59556e))

### Features

- change how monitors are setup, lifetime etc. Add MonitorInProgress and report statuses of monitors and packageContainers back to Core ([5cafa70](https://github.com/nrkno/tv-automation-package-manager/commit/5cafa70bd29ef46ac5dd50d29651d5a53ad32a08))
- back-port release37-features onto release36 ([e2955ec](https://github.com/nrkno/tv-automation-package-manager/commit/e2955ec72a545756c5e270141530c158d27d08e8))
