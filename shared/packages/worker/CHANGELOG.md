# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
