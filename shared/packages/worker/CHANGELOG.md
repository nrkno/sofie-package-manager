# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.51.0-alpha.0](https://github.com/nrkno/sofie-package-manager/compare/v1.50.7...v1.51.0-alpha.0) (2025-01-08)


### Bug Fixes

* add a `force` parameter to appcontainer.requestSpinDown() ([3255189](https://github.com/nrkno/sofie-package-manager/commit/3255189663d06d91e90d812bfc9a705589c5ba0d))
* add option to HTTP Accessor to either send a HEAD or GET to retrieve initial info ([e98854c](https://github.com/nrkno/sofie-package-manager/commit/e98854c32955c122aa6bf68a2ac47aa121448f40))
* allow baseUrl to be optional for HTTP Accessor ([92c575f](https://github.com/nrkno/sofie-package-manager/commit/92c575fa767cb3adba649619c16ca312b0253065))
* allow stringified JSON object as storeObject value. Also add some error handling ([0e589bf](https://github.com/nrkno/sofie-package-manager/commit/0e589bfb1809cc68f3ef6bf14a95ef02953966ce))
* change how render width, height and scale works for html_template expectedPackages ([7fcdf70](https://github.com/nrkno/sofie-package-manager/commit/7fcdf700fda413b94f39e7fb6107e26ee7dd9713))
* escape paths in args ([6c17eae](https://github.com/nrkno/sofie-package-manager/commit/6c17eae206bf548167e121ed2e429cdca46daa84))
* handle bad http respnse codes better ([1ad7b2d](https://github.com/nrkno/sofie-package-manager/commit/1ad7b2dd6b0828c49b54cc4613ddd0ae92b9fddc))
* html-renderer: add support for transparent backgrounds ([c3775a7](https://github.com/nrkno/sofie-package-manager/commit/c3775a71783e3ca915d950cb44055ed7e3f4f60e))
* html-renderer: bug in background color and cropping ([e3e0242](https://github.com/nrkno/sofie-package-manager/commit/e3e024264f05e433dee6c6d3878201d4950536cd))
* no need to re-throw in the catch ([8331ef4](https://github.com/nrkno/sofie-package-manager/commit/8331ef4c9b89fca091ccaf0f5176fedc21f0bcbf))
* reject absolute file paths ([cf207e6](https://github.com/nrkno/sofie-package-manager/commit/cf207e602a7b8c6b9efeca740e8c5bf657569a8c))
* remove outputPrefix for html-template expectations ([43e9887](https://github.com/nrkno/sofie-package-manager/commit/43e9887445c117dc6935960a0d881fd19c3d34dd))
* rename supperHEAD to useGETinsteadOfHead ([c75757e](https://github.com/nrkno/sofie-package-manager/commit/c75757e9c65ec0babf080652c20d0af50895a767))
* run HTMLRenderer using `yarn start` script when in development mode ([f3164b4](https://github.com/nrkno/sofie-package-manager/commit/f3164b48616710f5cd043475f4f0c9963400782e))


### Features

* add HTML Renderer ([8610b6e](https://github.com/nrkno/sofie-package-manager/commit/8610b6ebdb4bef441f9e56a3b3be512f3ccbcfad))
* refactor the failure tracking to track periods of time with failures within them ([d33f973](https://github.com/nrkno/sofie-package-manager/commit/d33f973fb5d7c67f442365dd29778e24766b0466))
* track failures in Workers in a time period (SOFIE-3355) ([732fa19](https://github.com/nrkno/sofie-package-manager/commit/732fa19fad801ae3be5600645fb5899d81aa11a0))





# [1.50.5](https://github.com/nrkno/tv-automation-package-manager/compare/v1.50.4...v1.50.5) (2024-04-09)

### Bug Fixes

- ensure we don't call QuantelGateway.connect" more than once at a time ([017a753](https://github.com/nrkno/tv-automation-package-manager/commit/017a75301d9347c2c633729e5df56a66f9a893f4))
- move the critical worker functionality into appContainer/workerAgent ([2fd7143](https://github.com/nrkno/tv-automation-package-manager/commit/2fd7143d292dafe139a93fc0b8915f38f9b7d9da))

## [1.50.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.50.2-alpha.3...v1.50.2) (2024-03-27)

### Bug Fixes

- (scaling): fix an issue where the workers never asked to be spun down ([212f014](https://github.com/nrkno/tv-automation-package-manager/commit/212f014954bdbc8421e8428b9fafc39662d1b1e3))

## [1.50.2-alpha.3](https://github.com/nrkno/tv-automation-package-manager/compare/v1.50.2-alpha.2...v1.50.2-alpha.3) (2024-03-25)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.50.2-alpha.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.50.2-alpha.1...v1.50.2-alpha.2) (2024-03-25)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.50.2-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.50.2-alpha.0...v1.50.2-alpha.1) (2024-03-25)

### Bug Fixes

- ensure that (robo-) copied files get their modified date updated ([1ad7431](https://github.com/nrkno/tv-automation-package-manager/commit/1ad74318d69ec6ff35dedd44fde1d9ca475dd917))

## [1.50.2-alpha.0](https://github.com/nrkno/sofie-package-manager/compare/v1.50.1...v1.50.2-alpha.0) (2024-02-29)

### Bug Fixes

- robocopy should not copy timstamps ([5856e55](https://github.com/nrkno/sofie-package-manager/commit/5856e5576c60747427712f6a005244150c7b6956))

# [1.50.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.50.0-alpha.10...v1.50.0) (2024-02-19)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.43.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.43.1...v1.43.2) (2024-02-19)

### Bug Fixes

- batch writes to json file, to avoid timeouts when scheduling many writes at the same time. ([d0d6b60](https://github.com/nrkno/tv-automation-package-manager/commit/d0d6b60b0e1725776ee0d4a8b9b3f2f073d7ead0))
- improve operations logging ([112ae2d](https://github.com/nrkno/tv-automation-package-manager/commit/112ae2dca22d83dc009504116272fa38f3cd7849))

## [1.43.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.43.0...v1.43.1) (2024-01-22)

### Bug Fixes

- refactor and fix issue with (wrongly) thown error "Error: Bad input data: content.filePath not set!" ([550e893](https://github.com/nrkno/tv-automation-package-manager/commit/550e8936cdbc464052d39c0efd5e60d3ece3a70d))

# [1.43.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.43.0-alpha.2...v1.43.0) (2024-01-11)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.43.0-alpha.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.43.0-alpha.1...v1.43.0-alpha.2) (2023-12-20)

### Bug Fixes

- better handling of when source isStable ([2198266](https://github.com/nrkno/tv-automation-package-manager/commit/2198266457e283062ec849a70740b892b33f555e))
- bug fix: wrong PackageIntoType ([312f401](https://github.com/nrkno/tv-automation-package-manager/commit/312f4010017350638462fd88faa77805b45b2b80))
- cache header http queries, to reduce external load ([8a64005](https://github.com/nrkno/tv-automation-package-manager/commit/8a640058eb2b8cb982e9a33cccd44573d444afd1))
- json-data-copy: properly store metadata for files ([b6a5212](https://github.com/nrkno/tv-automation-package-manager/commit/b6a5212d599cbd2b2f23bc0915a2e43fa8c27edc))

# [1.43.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.43.0-alpha.0...v1.43.0-alpha.1) (2023-12-05)

### Bug Fixes

- json data copying ([6ce0b05](https://github.com/nrkno/tv-automation-package-manager/commit/6ce0b0505d7b0bb18821cd2f8e4cc97820de6d96))

# [1.43.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.2...v1.43.0-alpha.0) (2023-11-30)

### Features

- make json data copy work ([ba050d5](https://github.com/nrkno/tv-automation-package-manager/commit/ba050d504d28584c0d7085bfac78a0afc025ecb2))

## [1.42.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.1...v1.42.2) (2023-10-12)

### Bug Fixes

- add new option `warningLimit` to monitor. ([a50b1a2](https://github.com/nrkno/tv-automation-package-manager/commit/a50b1a225719e78d1fd7471d9c183f1af888042d))
- bug ([6c99dd7](https://github.com/nrkno/tv-automation-package-manager/commit/6c99dd79542872f2281e8a82cf683be9dcf33b77))
- fix in file monitor ([3fb2eed](https://github.com/nrkno/tv-automation-package-manager/commit/3fb2eedee84a0992e969e96451040e4cdda418e1))
- replace chokidar file monitor with ParcelWatcher ([60922e4](https://github.com/nrkno/tv-automation-package-manager/commit/60922e403c60739c5360b61d932b526b98c70ef3))
- restart deep-scanning if ffpmeg doesn't output progress. ([a13b4f6](https://github.com/nrkno/tv-automation-package-manager/commit/a13b4f6eac488f880ab0c87de4ccca75963266e3))
- rewrite the retrying of ffmpeg ([c7a8b06](https://github.com/nrkno/tv-automation-package-manager/commit/c7a8b063362344f0c2acc63b44be80269bd571fc))
- wrap Accessor methods, in order to catch timeout issues earlier ([7f2a1f2](https://github.com/nrkno/tv-automation-package-manager/commit/7f2a1f2b1bcbce9ce1f3fcb15c4f2553a8cf03fe))
- wrap lookupAccessorHandles in promiseTimeout, in order to catch timeouts earlier ([dc95092](https://github.com/nrkno/tv-automation-package-manager/commit/dc95092f46dadabaacb60023ef59083f509dd74b))

## [1.42.1](https://github.com/nrkno/sofie-package-manager/compare/v1.42.1-alpha.4...v1.42.1) (2023-06-19)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.42.1-alpha.0](https://github.com/nrkno/sofie-package-manager/compare/v1.42.0...v1.42.1-alpha.0) (2023-06-09)

### Bug Fixes

- URL handling was broken, because it treated URLs as file paths ([827a939](https://github.com/nrkno/sofie-package-manager/commit/827a93961e9647927aef7970af8babbab028a29e))

# [1.42.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.5...v1.42.0) (2023-05-10)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.42.0-alpha.5](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.4...v1.42.0-alpha.5) (2023-05-10)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.42.0-alpha.4](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.3...v1.42.0-alpha.4) (2023-05-03)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.42.0-alpha.3](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.2...v1.42.0-alpha.3) (2023-05-03)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.42.0-alpha.2](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.1...v1.42.0-alpha.2) (2023-05-03)

### Bug Fixes

- add logging for when doing file (or other) operations. ([0407a3d](https://github.com/nrkno/tv-automation-package-manager/commit/0407a3dce15691d1d0424f730689f0230cc6736e))
- add logging when removing dir ([1a6a102](https://github.com/nrkno/tv-automation-package-manager/commit/1a6a102cf26bfaa443d6d6002f913c87a49152fe))
- add truePeak reporting ([51b78dd](https://github.com/nrkno/tv-automation-package-manager/commit/51b78ddc1fe2b76bea28bba6f1998ee431bf1830))

# [1.42.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-alpha.0...v1.42.0-alpha.1) (2023-04-26)

### Bug Fixes

- Old files where cleaned up from temporary-store prematurely. ([7025367](https://github.com/nrkno/tv-automation-package-manager/commit/70253672842ca208e6d046551886d328844b49cb))

# [1.42.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.42.0-0...v1.42.0-alpha.0) (2023-04-26)

### Bug Fixes

- **Loudness:** match only last scan result output ([c678c0b](https://github.com/nrkno/tv-automation-package-manager/commit/c678c0bce0dd75c7674502369730011d8cf480f0))
- don't double-escape URLs ([a1a4089](https://github.com/nrkno/tv-automation-package-manager/commit/a1a40895a8efa8e04d8896264e80770395e132eb))
- handle # in filenames and urls (%23, when URI encoded) ([c9ad9c8](https://github.com/nrkno/tv-automation-package-manager/commit/c9ad9c8d42d6ab865f3ac0b81891e1a02cbe985f))

### Features

- implement test ([afcd0b5](https://github.com/nrkno/tv-automation-package-manager/commit/afcd0b552f6bb66079c64162fc6f40c7f702b139))
- support failure in ffmpeg due to referencing a non-existant channel ([bf4888d](https://github.com/nrkno/tv-automation-package-manager/commit/bf4888d1d5525b3a4ee28f8b7e60e54c16c439a7))
- **Loudness:** Generate loduness scan of packages ([6e990d7](https://github.com/nrkno/tv-automation-package-manager/commit/6e990d7d8910cfd887317d69feb48a3a7e151589))

### Reverts

- Revert "chore: split out "@sofie-package-manager/input-api" to a separate package" ([8df7c18](https://github.com/nrkno/tv-automation-package-manager/commit/8df7c183d86436540b4e4b5489446d6340188b24))

# [1.42.0-0](https://github.com/nrkno/sofie-package-manager/compare/v1.41.1...v1.42.0-0) (2023-03-22)

### Bug Fixes

- ensure that target file paths exists before writing to file ([2d5381d](https://github.com/nrkno/sofie-package-manager/commit/2d5381db576de694b14a3a94c26f525f75ddfd9b))

### Features

- Package manager placeholder ([47d2e1f](https://github.com/nrkno/sofie-package-manager/commit/47d2e1f64ffe90fe7a5fe967e83bca0befb66471))

## [1.41.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.41.0...v1.41.1) (2023-02-22)

### Bug Fixes

- add packageExists property to tryPackageRead() method, in order to return better sourceExists from isFileReadyToStartWorkingOn() ([ddccbbe](https://github.com/nrkno/tv-automation-package-manager/commit/ddccbbef9d7c00340cb746ad8e2645e143ea6de9))
- adjust MESSAGE_TIMEOUT during unit tests ([2411472](https://github.com/nrkno/tv-automation-package-manager/commit/2411472811f39835985d3d86c7950d12be077b5c))
- bug in joinUrls where it incorrectly joined the paths ("asdf/package", "//nas/folder/path") ([72b837a](https://github.com/nrkno/tv-automation-package-manager/commit/72b837acebae1eb3140400226fdcc58d91169d15))
- packageExists value ([fc7e5c6](https://github.com/nrkno/tv-automation-package-manager/commit/fc7e5c6275eefcca86c9c4c124d9fc5bd7b809fa))

# [1.41.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.41.0-alpha.1...v1.41.0) (2023-02-03)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.41.0-alpha.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.41.0-alpha.0...v1.41.0-alpha.1) (2023-02-03)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.41.0-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.40.2...v1.41.0-alpha.0) (2023-01-27)

### Bug Fixes

- CachedQuantelGateway: ([6597efe](https://github.com/nrkno/tv-automation-package-manager/commit/6597efe7b990b8152b3468a1842deadc168e621f))
- rework CachedQuantelGateway ([216ac06](https://github.com/nrkno/tv-automation-package-manager/commit/216ac062114d464e89270e5ce0ead6e9bddeb367))

## [1.40.1](https://github.com/nrkno/sofie-package-manager/compare/v1.40.0...v1.40.1) (2023-01-26)

**Note:** Version bump only for package @sofie-package-manager/worker

# [1.40.0](https://github.com/nrkno/sofie-package-manager/compare/v1.39.8-alpha.4...v1.40.0) (2023-01-23)

### Bug Fixes

- don't respect timeSinceLastError if state is RESTARTED ([c94de26](https://github.com/nrkno/sofie-package-manager/commit/c94de268c27669be90b58c5a3d6fcc7321d23c4b))
- remove dependency on blueprints-integration ([e545992](https://github.com/nrkno/sofie-package-manager/commit/e545992e5204ff836e86011edeee7c08fdcaeaff))

### Features

- CachedQuantelGateway to buffer requests ([33a2477](https://github.com/nrkno/sofie-package-manager/commit/33a2477d8b6ce495f6d2694e431f14a2fa90eeec))

## [1.39.8-alpha.4](https://github.com/nrkno/sofie-package-manager/compare/v1.39.8-alpha.3...v1.39.8-alpha.4) (2023-01-17)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.39.8-alpha.3](https://github.com/nrkno/sofie-package-manager/compare/v1.39.8-alpha.2...v1.39.8-alpha.3) (2023-01-13)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.39.8-alpha.2](https://github.com/nrkno/sofie-package-manager/compare/v1.39.8-alpha.1...v1.39.8-alpha.2) (2023-01-12)

### Bug Fixes

- **Quantel:** shorten QUANTEL_TIMEOUT to be lower than INNER_ACTION_TIMEOUT ([0758974](https://github.com/nrkno/sofie-package-manager/commit/075897441dd64cba0cb8d0723483e052c08cfecb))

## [1.39.8-alpha.1](https://github.com/nrkno/sofie-package-manager/compare/v1.39.8-alpha.0...v1.39.8-alpha.1) (2023-01-12)

### Bug Fixes

- add packageHandle.packageIsInPlace() method, used to signal that a package is in place (or is about to be), so that any scheduled delayRemoval are cleared. ([1a71bc5](https://github.com/nrkno/sofie-package-manager/commit/1a71bc5aca80013915a0932f7f2cff9e48e01c12))
- potential issue when using temporaryFilePaths and renaming a file to an already existing file ([17caa32](https://github.com/nrkno/sofie-package-manager/commit/17caa32fd1670ca92c06c0657540c5bfbfc6a4a9))

## [1.39.8-alpha.0](https://github.com/nrkno/sofie-package-manager/compare/v1.39.7...v1.39.8-alpha.0) (2023-01-12)

### Bug Fixes

- increase timeout on quantel ([d0e0379](https://github.com/nrkno/sofie-package-manager/commit/d0e03799e7d3fd7218c87c8a505d010be6080ab1))

## [1.39.7](https://github.com/nrkno/sofie-package-manager/compare/v1.39.6...v1.39.7) (2023-01-11)

### Bug Fixes

- update quantel-gateway-client ([0f75c1e](https://github.com/nrkno/sofie-package-manager/commit/0f75c1e330daee7dec31cc6499213309f3f6708e))

## [1.39.6](https://github.com/nrkno/sofie-package-manager/compare/v1.39.5...v1.39.6) (2023-01-09)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.39.5](https://github.com/nrkno/sofie-package-manager/compare/v1.39.4...v1.39.5) (2023-01-09)

**Note:** Version bump only for package @sofie-package-manager/worker

## [1.39.4](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.4-alpha.0...v1.39.4) (2023-01-04)

### Bug Fixes

- a recursive function needs to be called recursively ([8e06bbf](https://github.com/nrkno/tv-automation-package-manager/commit/8e06bbf097ab9c691b9415571116f5dd618d7881))
- replace dots with underscore in keys in scan results. ([e05f8ef](https://github.com/nrkno/tv-automation-package-manager/commit/e05f8ef05c934453a71e59458392497401a55b9c))

## [1.39.4-alpha.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.3...v1.39.4-alpha.0) (2022-12-05)

### Bug Fixes

- blackDetectRegex expects black_duration to be a number with a decimal point ([#19](https://github.com/nrkno/tv-automation-package-manager/issues/19)) ([bb23fba](https://github.com/nrkno/tv-automation-package-manager/commit/bb23fba5dd9ffb97ee8791bd3342bbf0e482aa73))

## [1.39.3](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.2...v1.39.3) (2022-11-30)

### Bug Fixes

- Update default values to generate larger media preview thumbnails ([f3d0bd7](https://github.com/nrkno/tv-automation-package-manager/commit/f3d0bd764b20753f751e53c49f27abb86f739f07))

## [1.39.1](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.0...v1.39.1) (2022-09-16)

### Bug Fixes

- a case where multiple QuantelGateway clients where spawned by mistake ([bfb42a5](https://github.com/nrkno/tv-automation-package-manager/commit/bfb42a53e50a0de48cecab3c2275dc3f766c097c))
- minor improvements to the rateLimiter of the file-watcher ([7741626](https://github.com/nrkno/tv-automation-package-manager/commit/77416267c48a1ff528b6d04c6bcb3db756e54cf0))

# [1.39.0](https://github.com/nrkno/tv-automation-package-manager/compare/v1.39.0-in-development.1...v1.39.0) (2022-09-07)

### Bug Fixes

- add WorkerStorage to AppContainer, to be used for storing data from workers ([19a1516](https://github.com/nrkno/tv-automation-package-manager/commit/19a15166c9fece12d8474227c4ac0833c115632d))
- allow empty baseUrl for http accessor ([68af3d4](https://github.com/nrkno/tv-automation-package-manager/commit/68af3d436efe02bd4b2d446ffc23a234a6ad2c23))
- better handling (or hack) of the "connect EADDRINUSE" issue, by swallowing the error and try again once ([3cd4dcc](https://github.com/nrkno/tv-automation-package-manager/commit/3cd4dccc381279afe09f9ed4129e67dc427b9da2))
- bug fix: invert logic ([2f2db03](https://github.com/nrkno/tv-automation-package-manager/commit/2f2db0389bb7268c9eba4b136bcc469f407ca8fc))
- bug fix: use startRequirement for source, for CopyProxy ([d7cdfee](https://github.com/nrkno/tv-automation-package-manager/commit/d7cdfeebad6d0dc824fb676673bb935acc69d332))
- bug in workerAgent, where the job wasn't cancelled upon timeout in workerAgent ([8cf0020](https://github.com/nrkno/tv-automation-package-manager/commit/8cf002023b366b0b1d711ceff7aac885a0a000ed))
- DataStorage: add custom timeout duration for write locks ([32d993d](https://github.com/nrkno/tv-automation-package-manager/commit/32d993d8025c4b2b300f35fd437e1339bc0d497f))
- ffmpeg-issues on Windows ([3a523df](https://github.com/nrkno/tv-automation-package-manager/commit/3a523df3061680afcabb83315bbf9bfc0d4c221a))
- FileShare: fast-path to avoid a timeout issue when many read/write-calls are queued at the same time ([cfe389c](https://github.com/nrkno/tv-automation-package-manager/commit/cfe389c09e31c50c982e590c20741d986b0cd09f))
- graceful process handling ([#9](https://github.com/nrkno/tv-automation-package-manager/issues/9)) ([47ac8e1](https://github.com/nrkno/tv-automation-package-manager/commit/47ac8e16f13803c8273b0768d0bb48e560fbedc2))
- handle errors in killFFMpeg by ignoring them ([43ff037](https://github.com/nrkno/tv-automation-package-manager/commit/43ff037e4e1d4e0f10192c1351164578cfceee26))
- hide ffmpeg banner to decrease log size ([e3a24c2](https://github.com/nrkno/tv-automation-package-manager/commit/e3a24c2c4e11b5e4ea21a9af013dde10ec0e8860))
- improve logging, adding categories for logger to make it easier to know where a lig line comes from ([db18a35](https://github.com/nrkno/tv-automation-package-manager/commit/db18a35e841169f0ace1b3d42db2b9932c15f88d))
- improve performance for preview generation ([c761c8b](https://github.com/nrkno/tv-automation-package-manager/commit/c761c8bc6646e67a2fcdaf6ea096db389007a327))
- improve proxy-copy when copying from quantel http-transformer ([8385e3a](https://github.com/nrkno/tv-automation-package-manager/commit/8385e3ad540cac5c31c0d5c8fe1f56496a4d40e3))
- increase HTTP_TIMEOUT to reduce Socket turnover ([d26ea5d](https://github.com/nrkno/tv-automation-package-manager/commit/d26ea5d1d883794a7fff7e6d818fff0878d0021c))
- issues with black&freeze detection ([be1adf8](https://github.com/nrkno/tv-automation-package-manager/commit/be1adf84437158295b9c0734265ab2097a09b16e))
- only do a single job per worker ([fc94d3c](https://github.com/nrkno/tv-automation-package-manager/commit/fc94d3c64b468475625adb510290321b52fddf3d))
- refactor FFMpeg execution for previews ([2e7e9ea](https://github.com/nrkno/tv-automation-package-manager/commit/2e7e9ea6286192e76e7bbadc58457dcfa8b16f06))
- replace execFile with spawn and use maxBuffer in other places ([3816100](https://github.com/nrkno/tv-automation-package-manager/commit/38161003542d6c4c6c63a67b5bb59439df00de9b))
- report progress 0 only after FFMpeg detects duration ([7809d73](https://github.com/nrkno/tv-automation-package-manager/commit/7809d730040259d0687cd413dc2c60dc74a9b815))
- use HTTP agents for fetch ([bf3cecc](https://github.com/nrkno/tv-automation-package-manager/commit/bf3cecc0533c89867cf80b808a7f944edb174cd2))
- workaround for windows-network-drive not returning all devices. ([46bc210](https://github.com/nrkno/tv-automation-package-manager/commit/46bc2104b0dacb8c0944790f7b631df16b0523e1))
- worker child processes exit with null code ([#11](https://github.com/nrkno/tv-automation-package-manager/issues/11)) ([19ebe9c](https://github.com/nrkno/tv-automation-package-manager/commit/19ebe9c543453b9f3d65abeb071a69010ceca92f))
- Worker: use AppContainer datastore in order to ensure that only one worker is accessing windows drive letters at the same time. ([6c3b58b](https://github.com/nrkno/tv-automation-package-manager/commit/6c3b58b192a5558b6ab7f12178a10625e0af3585))

### Features

- add CLI option: considerCPULoad ([6da6ab0](https://github.com/nrkno/tv-automation-package-manager/commit/6da6ab0beab48fb59d29b3fcbfc6a3d0e4aa5de4))
- support for "temporary-storage"; by copying packages to a local PackageContainer, scanning, preview-generation etc can be done quicker. ([31513f3](https://github.com/nrkno/tv-automation-package-manager/commit/31513f3b2b46054c57c8ff6110abd7285d8983c6))
- **worker/accessorHandlers/http(Proxy):** rethrow last timeout error ([9599603](https://github.com/nrkno/tv-automation-package-manager/commit/9599603c8356e2ee20dad770c9d828b4b39f1999))
- use HEAD requests for querying http-servers ([a077126](https://github.com/nrkno/tv-automation-package-manager/commit/a07712643af9c35b8b61de8b4e2113553fc3a259))

### Reverts

- Revert "feat(worker/accessorHandlers/http(Proxy)): add retries to getPackagesToRemove for resiliance" ([f278d2f](https://github.com/nrkno/tv-automation-package-manager/commit/f278d2fad29474bc5e04393d7c6e4e981031e5b5))

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
