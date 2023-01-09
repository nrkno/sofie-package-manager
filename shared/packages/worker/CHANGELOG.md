# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.39.6](https://github.com/nrkno/sofie-package-manager/compare/v1.39.5...v1.39.6) (2023-01-09)

**Note:** Version bump only for package @sofie-package-manager/worker





## [1.39.5](https://github.com/nrkno/sofie-package-manager/compare/v1.39.4...v1.39.5) (2023-01-09)

**Note:** Version bump only for package @sofie-package-manager/worker





## [1.39.4](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.4-alpha.0...v1.39.4) (2023-01-04)


### Bug Fixes

* a recursive function needs to be called recursively ([8e06bbf](https://github.com/nrkno/tv-automation-package-manager/commit/8e06bbf097ab9c691b9415571116f5dd618d7881))
* replace dots with underscore in keys in scan results. ([e05f8ef](https://github.com/nrkno/tv-automation-package-manager/commit/e05f8ef05c934453a71e59458392497401a55b9c))





## [1.39.4-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.3...v1.39.4-alpha.0) (2022-12-05)


### Bug Fixes

* blackDetectRegex expects black_duration to be a number with a decimal point ([#19](https://github.com/nrkno/tv-automation-package-manager/issues/19)) ([bb23fba](https://github.com/nrkno/tv-automation-package-manager/commit/bb23fba5dd9ffb97ee8791bd3342bbf0e482aa73))





## [1.39.3](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.2...v1.39.3) (2022-11-30)


### Bug Fixes

* Update default values to generate larger media preview thumbnails ([f3d0bd7](https://github.com/nrkno/tv-automation-package-manager/commit/f3d0bd764b20753f751e53c49f27abb86f739f07))





## [1.39.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.0...v1.39.1) (2022-09-16)


### Bug Fixes

* a case where multiple QuantelGateway clients where spawned by mistake ([bfb42a5](https://github.com/nrkno/tv-automation-package-manager/commit/bfb42a53e50a0de48cecab3c2275dc3f766c097c))
* minor improvements to the rateLimiter of the file-watcher ([7741626](https://github.com/nrkno/tv-automation-package-manager/commit/77416267c48a1ff528b6d04c6bcb3db756e54cf0))





# [1.39.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.0-in-development.1...v1.39.0) (2022-09-07)


### Bug Fixes

* add WorkerStorage to AppContainer, to be used for storing data from workers ([19a1516](https://github.com/nrkno/tv-automation-package-manager/commit/19a15166c9fece12d8474227c4ac0833c115632d))
* allow empty baseUrl for http accessor ([68af3d4](https://github.com/nrkno/tv-automation-package-manager/commit/68af3d436efe02bd4b2d446ffc23a234a6ad2c23))
* better handling (or hack) of the "connect EADDRINUSE" issue, by swallowing the error and try again once ([3cd4dcc](https://github.com/nrkno/tv-automation-package-manager/commit/3cd4dccc381279afe09f9ed4129e67dc427b9da2))
* bug fix: invert logic ([2f2db03](https://github.com/nrkno/tv-automation-package-manager/commit/2f2db0389bb7268c9eba4b136bcc469f407ca8fc))
* bug fix: use startRequirement for source, for CopyProxy ([d7cdfee](https://github.com/nrkno/tv-automation-package-manager/commit/d7cdfeebad6d0dc824fb676673bb935acc69d332))
* bug in workerAgent, where the job wasn't cancelled upon timeout in workerAgent ([8cf0020](https://github.com/nrkno/tv-automation-package-manager/commit/8cf002023b366b0b1d711ceff7aac885a0a000ed))
* DataStorage: add custom timeout duration for write locks ([32d993d](https://github.com/nrkno/tv-automation-package-manager/commit/32d993d8025c4b2b300f35fd437e1339bc0d497f))
* ffmpeg-issues on Windows ([3a523df](https://github.com/nrkno/tv-automation-package-manager/commit/3a523df3061680afcabb83315bbf9bfc0d4c221a))
* FileShare: fast-path to avoid a timeout issue when many read/write-calls are queued at the same time ([cfe389c](https://github.com/nrkno/tv-automation-package-manager/commit/cfe389c09e31c50c982e590c20741d986b0cd09f))
* graceful process handling ([#9](https://github.com/nrkno/tv-automation-package-manager/issues/9)) ([47ac8e1](https://github.com/nrkno/tv-automation-package-manager/commit/47ac8e16f13803c8273b0768d0bb48e560fbedc2))
* handle errors in killFFMpeg by ignoring them ([43ff037](https://github.com/nrkno/tv-automation-package-manager/commit/43ff037e4e1d4e0f10192c1351164578cfceee26))
* hide ffmpeg banner to decrease log size ([e3a24c2](https://github.com/nrkno/tv-automation-package-manager/commit/e3a24c2c4e11b5e4ea21a9af013dde10ec0e8860))
* improve logging, adding categories for logger to make it easier to know where a lig line comes from ([db18a35](https://github.com/nrkno/tv-automation-package-manager/commit/db18a35e841169f0ace1b3d42db2b9932c15f88d))
* improve performance for preview generation ([c761c8b](https://github.com/nrkno/tv-automation-package-manager/commit/c761c8bc6646e67a2fcdaf6ea096db389007a327))
* improve proxy-copy when copying from quantel http-transformer ([8385e3a](https://github.com/nrkno/tv-automation-package-manager/commit/8385e3ad540cac5c31c0d5c8fe1f56496a4d40e3))
* increase HTTP_TIMEOUT to reduce Socket turnover ([d26ea5d](https://github.com/nrkno/tv-automation-package-manager/commit/d26ea5d1d883794a7fff7e6d818fff0878d0021c))
* issues with black&freeze detection ([be1adf8](https://github.com/nrkno/tv-automation-package-manager/commit/be1adf84437158295b9c0734265ab2097a09b16e))
* only do a single job per worker ([fc94d3c](https://github.com/nrkno/tv-automation-package-manager/commit/fc94d3c64b468475625adb510290321b52fddf3d))
* refactor FFMpeg execution for previews ([2e7e9ea](https://github.com/nrkno/tv-automation-package-manager/commit/2e7e9ea6286192e76e7bbadc58457dcfa8b16f06))
* replace execFile with spawn and use maxBuffer in other places ([3816100](https://github.com/nrkno/tv-automation-package-manager/commit/38161003542d6c4c6c63a67b5bb59439df00de9b))
* report progress 0 only after FFMpeg detects duration ([7809d73](https://github.com/nrkno/tv-automation-package-manager/commit/7809d730040259d0687cd413dc2c60dc74a9b815))
* use HTTP agents for fetch ([bf3cecc](https://github.com/nrkno/tv-automation-package-manager/commit/bf3cecc0533c89867cf80b808a7f944edb174cd2))
* workaround for windows-network-drive not returning all devices. ([46bc210](https://github.com/nrkno/tv-automation-package-manager/commit/46bc2104b0dacb8c0944790f7b631df16b0523e1))
* worker child processes exit with null code ([#11](https://github.com/nrkno/tv-automation-package-manager/issues/11)) ([19ebe9c](https://github.com/nrkno/tv-automation-package-manager/commit/19ebe9c543453b9f3d65abeb071a69010ceca92f))
* Worker: use AppContainer datastore in order to ensure that only one worker is accessing windows drive letters at the same time. ([6c3b58b](https://github.com/nrkno/tv-automation-package-manager/commit/6c3b58b192a5558b6ab7f12178a10625e0af3585))


### Features

* add CLI option: considerCPULoad ([6da6ab0](https://github.com/nrkno/tv-automation-package-manager/commit/6da6ab0beab48fb59d29b3fcbfc6a3d0e4aa5de4))
* support for "temporary-storage"; by copying packages to a local PackageContainer, scanning, preview-generation etc can be done quicker. ([31513f3](https://github.com/nrkno/tv-automation-package-manager/commit/31513f3b2b46054c57c8ff6110abd7285d8983c6))
* **worker/accessorHandlers/http(Proxy):** rethrow last timeout error ([9599603](https://github.com/nrkno/tv-automation-package-manager/commit/9599603c8356e2ee20dad770c9d828b4b39f1999))
* use HEAD requests for querying http-servers ([a077126](https://github.com/nrkno/tv-automation-package-manager/commit/a07712643af9c35b8b61de8b4e2113553fc3a259))


### Reverts

* Revert "feat(worker/accessorHandlers/http(Proxy)): add retries to getPackagesToRemove for resiliance" ([f278d2f](https://github.com/nrkno/tv-automation-package-manager/commit/f278d2fad29474bc5e04393d7c6e4e981031e5b5))





# [1.39.0-in-development.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.0-in-development.0...v1.39.0-in-development.1) (2022-02-15)

### Bug Fixes

- bug fix: previews & thumbnails metadata files wasn't stored propery for non latin file names ([4c48084](https://github.com/nrkno/tv-automation-package-manager/commit/4c48084c80710a4c567373f0ae7bf2a8a857a6b1))
- fs.open read access check ([2f9ab79](https://github.com/nrkno/tv-automation-package-manager/commit/2f9ab794e135e6e9a242fd277ff4f978c8457782))
- let the worker fix an issue with the filePath automatically. ([0dfec72](https://github.com/nrkno/tv-automation-package-manager/commit/0dfec72fa4ba58b1bc81e0f15ca8987b6db77d91))
- tidy up urls for http-upload a bit ([753d5dc](https://github.com/nrkno/tv-automation-package-manager/commit/753d5dcad868dc8f3d10bacf598c5a034d85b04b))

# [1.39.0-in-development.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.1...v1.39.0-in-development.0) (2022-01-27)

### Bug Fixes

- A pretty large rehaul of connection logic. ([4b20139](https://github.com/nrkno/tv-automation-package-manager/commit/4b201394c3074b5601ae6c4452129dde2d7318eb))
- add "HelpfulEventEmitter" to be used instead ot EventEmitter,, because it'll give the developer a warning if they've forgotten to listen to error events. ([fc1b1db](https://github.com/nrkno/tv-automation-package-manager/commit/fc1b1db8f99abbc35bbd39ba87cee870c3df1885))
- allow deep scanning of audio-only files ([27ebd36](https://github.com/nrkno/tv-automation-package-manager/commit/27ebd3654f1cff3ee97ade486eaae74ca9ef876e))
- better handling of FFScan errors ([dd2d643](https://github.com/nrkno/tv-automation-package-manager/commit/dd2d6439eedfde8d391c092edb4cedd9403549ca))
- bug: Quantel clips with no frames showed up as fullfilled ([d986e09](https://github.com/nrkno/tv-automation-package-manager/commit/d986e09fea6a5f30b509df7b0db1af40c047160a))
- create folder if it doesn't exist ([daec566](https://github.com/nrkno/tv-automation-package-manager/commit/daec566c9fcb1f62a69101dab305e7f34dcb0502))
- file access errors doesn't need to include stack ([eed5507](https://github.com/nrkno/tv-automation-package-manager/commit/eed5507d909796634905b90720395b629bc58b5a))
- fine-grained priority of accessors ([87f26c0](https://github.com/nrkno/tv-automation-package-manager/commit/87f26c09cb069422d691c509aa8001a6872c7639))
- handle unhandled promises ([13a6f5a](https://github.com/nrkno/tv-automation-package-manager/commit/13a6f5a2a7afde41b06538414d517b132e630edb))
- improve how loss-of-connections are handled ([60c74fb](https://github.com/nrkno/tv-automation-package-manager/commit/60c74fbb3e3f7ff43b2caf76d85e3c63c7a44718))
- in init() methods: wait for the 'connected' event being handled before finishing initializing ([b767e0d](https://github.com/nrkno/tv-automation-package-manager/commit/b767e0d4269e379c316a1a62341d0fd1933f9d6e))
- prevent active httpProxy file uploads from timing out ([0c22f69](https://github.com/nrkno/tv-automation-package-manager/commit/0c22f698a1b0ffadfc68a681098eccb40b1b36bc))
- receivers will not time out if their methods are unresponsive. ([b08c9ac](https://github.com/nrkno/tv-automation-package-manager/commit/b08c9ac39885d4a26bbdb5f28b3f4785878cb977))
- time out http-fetches properly, to avoid ugly timed out action errors ([a6fee11](https://github.com/nrkno/tv-automation-package-manager/commit/a6fee113d59a5b666f05977225d4a55a6f9e5b09))
- **fileCopy:** fix copy/paste typo in error message ([943681b](https://github.com/nrkno/tv-automation-package-manager/commit/943681b5bdce8144de56609541a54f73706daaba))
- Worker should remove a cancelled job right away, not wait for the work to actually finish ([cd11a16](https://github.com/nrkno/tv-automation-package-manager/commit/cd11a1678b06b1462f2b2f7c170ff98ef561da95))

### Features

- add support for uploading packages to ATEM video switchers ([798ee85](https://github.com/nrkno/tv-automation-package-manager/commit/798ee85e23d4ef9c8cd539ffd17e4bc6a439017b))
- Add the expectationHandler "fileVerify", used to just verify that a file exists, ([adbaf25](https://github.com/nrkno/tv-automation-package-manager/commit/adbaf25177ab6ac7df47199c6be3d1f6de8122ca))
- **fileCopy:** allow reporting progress using a custom event ([020a47f](https://github.com/nrkno/tv-automation-package-manager/commit/020a47f1023b1a1cfd57bf5891969bb8b27ec465))
- **windowsWorker:** allow omitting individual fields from VersionProperty ([3879b2f](https://github.com/nrkno/tv-automation-package-manager/commit/3879b2f96c8be8133a6bd5125d768a74adcd7f92))

# [1.38.0-in-testing.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0...v1.38.0-in-testing.0) (2021-12-17)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.38.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0...v1.38.0-alpha.0) (2021-12-17)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.37.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.1...v1.37.0) (2021-12-17)

### Bug Fixes

- A pretty large rehaul of connection logic. ([4b20139](https://github.com/nrkno/tv-automation-package-manager/commit/4b201394c3074b5601ae6c4452129dde2d7318eb))
- add "HelpfulEventEmitter" to be used instead ot EventEmitter,, because it'll give the developer a warning if they've forgotten to listen to error events. ([fc1b1db](https://github.com/nrkno/tv-automation-package-manager/commit/fc1b1db8f99abbc35bbd39ba87cee870c3df1885))
- bug: Quantel clips with no frames showed up as fullfilled ([d986e09](https://github.com/nrkno/tv-automation-package-manager/commit/d986e09fea6a5f30b509df7b0db1af40c047160a))
- file access errors doesn't need to include stack ([eed5507](https://github.com/nrkno/tv-automation-package-manager/commit/eed5507d909796634905b90720395b629bc58b5a))
- fine-grained priority of accessors ([87f26c0](https://github.com/nrkno/tv-automation-package-manager/commit/87f26c09cb069422d691c509aa8001a6872c7639))
- handle unhandled promises ([13a6f5a](https://github.com/nrkno/tv-automation-package-manager/commit/13a6f5a2a7afde41b06538414d517b132e630edb))
- improve how loss-of-connections are handled ([60c74fb](https://github.com/nrkno/tv-automation-package-manager/commit/60c74fbb3e3f7ff43b2caf76d85e3c63c7a44718))
- in init() methods: wait for the 'connected' event being handled before finishing initializing ([b767e0d](https://github.com/nrkno/tv-automation-package-manager/commit/b767e0d4269e379c316a1a62341d0fd1933f9d6e))
- receivers will not time out if their methods are unresponsive. ([b08c9ac](https://github.com/nrkno/tv-automation-package-manager/commit/b08c9ac39885d4a26bbdb5f28b3f4785878cb977))
- Worker should remove a cancelled job right away, not wait for the work to actually finish ([cd11a16](https://github.com/nrkno/tv-automation-package-manager/commit/cd11a1678b06b1462f2b2f7c170ff98ef561da95))

# [1.37.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.37.0-alpha.0...v1.37.0-alpha.1) (2021-11-05)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.37.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.1.1...v1.37.0-alpha.0) (2021-11-05)

### Bug Fixes

- add CLI option to multiply worker cost ([3d4f131](https://github.com/nrkno/tv-automation-package-manager/commit/3d4f131c099d0f2c799016929148930f938ce603))
- bug fix: quantel clone by title didn't work at all ([b502862](https://github.com/nrkno/tv-automation-package-manager/commit/b502862de54cc7b9510e671220ded2127881a5cf))
- check for status change while ABORTING ([b36c6e0](https://github.com/nrkno/tv-automation-package-manager/commit/b36c6e0ea7cc61b6de5d72d1868c66e95c5b6488))
- check if fileflowURL is set on accessor when selecting the best accessor ([abca120](https://github.com/nrkno/tv-automation-package-manager/commit/abca120658b7f4b849a487c8d8aa2f7ae8e816c0))
- disable drive mapping when using FileFlow ([7800b82](https://github.com/nrkno/tv-automation-package-manager/commit/7800b826f662a7fe9e558ac36c14deadd428bef9))
- Fileflow exports correctly created ([b1f8547](https://github.com/nrkno/tv-automation-package-manager/commit/b1f85473ef0d8ce126e12b5a153f6349227128c7))
- fileflow only supports Quantel to File_Share ([a79664d](https://github.com/nrkno/tv-automation-package-manager/commit/a79664d9a46a3ca868cc23685de50b9fc79ec71b))
- guid / title may be set in Quantel Accessor ([98dcb53](https://github.com/nrkno/tv-automation-package-manager/commit/98dcb539dfb7c4c1a4a0340c5833f491fced3ab4))
- more forgiving comparison of resource/network ids ([e3041df](https://github.com/nrkno/tv-automation-package-manager/commit/e3041df8741ed528263beddc7663eae3c068f7c5))
- Quantel: handle edge case when title of clip has been changed ([e9d1dca](https://github.com/nrkno/tv-automation-package-manager/commit/e9d1dca9805257357ff5463854614e289e7bd5c6))
- refactor and fix: use guid & title from content or accessor interchangeably ([171b396](https://github.com/nrkno/tv-automation-package-manager/commit/171b3963a149ec0e7288c726f695ab28f7e33420))

### Features

- add fileflow profile support for Quantel Fileflow copy ([38cfbfa](https://github.com/nrkno/tv-automation-package-manager/commit/38cfbfa3402ac3a80e1c9efc5e70ae20243ecc7e))
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

## [1.0.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.0.1...v1.0.2) (2021-09-15)

### Bug Fixes

- all handlers that handle http_proxy should also be able to handle http ([feac6d7](https://github.com/nrkno/tv-automation-package-manager/commit/feac6d7dc03817f8ce01594ef2070c7bcb955834))
- previews should support the source-types file-share and http_proxy ([982ff4f](https://github.com/nrkno/tv-automation-package-manager/commit/982ff4f396be8a676a1498c5241ac912a7e3afb7))
