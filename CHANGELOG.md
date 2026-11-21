# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/Mossad-esc/stellar-footprint-engine/compare/stellar-footprint-engine-v1.0.0...stellar-footprint-engine-v1.1.0) (2026-11-21)


### Features

* add /api/v1/ versioning prefix to all routes ([3ed9ed5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3ed9ed547a062290d884597dacb1d6e4908d5a9b))
* add autocannon load testing script ([#201](https://github.com/Mossad-esc/stellar-footprint-engine/issues/201)) ([1a24141](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1a24141d85d16851495f2ceee5bdf61e77670017))
* add autocannon load testing script ([#244](https://github.com/Mossad-esc/stellar-footprint-engine/issues/244)) ([971483c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/971483c26056e01c20bf673d76ed4ee867a3be1b))
* add batch simulation endpoint POST /api/simulate/batch ([760ae95](https://github.com/Mossad-esc/stellar-footprint-engine/commit/760ae95cbb30effa615042d8810daff13b9885f3))
* add CI security audit gate, webhook e2e test, and XDR property tests ([#159](https://github.com/Mossad-esc/stellar-footprint-engine/issues/159)) ([21b654d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/21b654dfb114d6b3ca6bea733ca641efcc335275))
* add circuit breaker for Stellar RPC calls ([47ee6bc](https://github.com/Mossad-esc/stellar-footprint-engine/commit/47ee6bc84f28b9994fb1be363b6ecd6f9cab61af))
* add configurable request timeout middleware ([354c194](https://github.com/Mossad-esc/stellar-footprint-engine/commit/354c194cdab23b8e8832ba32a0e6d151196ec666))
* add configurable request timeout middleware ([c8ded62](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c8ded62c94b2a15ebd2eff0f9250e31b866c8a68))
* add contract existence check before simulation ([ba5c77a](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ba5c77a2fcd642ef5997950d3a2f6654d40f900b))
* add contract existence check before simulation ([e87c65c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e87c65c50e3cbb541af547c497544d6a4000cf4b))
* add detailed cost breakdown endpoint ([f6473ab](https://github.com/Mossad-esc/stellar-footprint-engine/commit/f6473ababb2911c787c3be781b72731893bad52d))
* add detailed cost breakdown endpoint ([4d0ee12](https://github.com/Mossad-esc/stellar-footprint-engine/commit/4d0ee12b6c5d3558d2f03197842b03f1d49ddcc4)), closes [#413](https://github.com/Mossad-esc/stellar-footprint-engine/issues/413)
* add dev and prod Docker Compose configurations ([3f230d0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3f230d0b27ebed3691923cb18102c0d033c08e24))
* add dev and prod Docker Compose configurations ([69ca120](https://github.com/Mossad-esc/stellar-footprint-engine/commit/69ca120efa89d15aeacf1c5ca977836b5d435152)), closes [#119](https://github.com/Mossad-esc/stellar-footprint-engine/issues/119)
* add Dockerfile and docker-compose for containerized deployment ([7f63f15](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7f63f15a098ec27bdf9e453ac415aed1f35d7dc4))
* add dry-run mode to skip RPC call during simulation ([3acfc23](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3acfc231a5660fe364a0b9de04e1d7c0623784e4)), closes [#115](https://github.com/Mossad-esc/stellar-footprint-engine/issues/115)
* add dry-run mode to skip RPC call during simulation ([#141](https://github.com/Mossad-esc/stellar-footprint-engine/issues/141) resolved) ([3904eff](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3904effa28fdf80e5d199ccc9b6fe7c4c155326a))
* add dry-run mode to skip RPC call during simulation ([#266](https://github.com/Mossad-esc/stellar-footprint-engine/issues/266)) ([cefb8c3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/cefb8c376563a8a401c137d138f620ce789f8984))
* add explicit Referrer-Policy: no-referrer header ([3771914](https://github.com/Mossad-esc/stellar-footprint-engine/commit/37719144e15d92435192bfcd95addf63c628bf4a))
* add explicit Referrer-Policy: no-referrer header ([6b404ee](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6b404ee6b548f70bf241e109c3f4797b826d7dee))
* add explicit Referrer-Policy: no-referrer header ([fb886bd](https://github.com/Mossad-esc/stellar-footprint-engine/commit/fb886bde1865ee2e7972e9f1f9ea7c3cfdfb4b9b))
* add exponential backoff retry for transient RPC failures ([b313fe6](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b313fe6f34ec58c90318a3f280a76a6a338e22fd))
* add exponential backoff retry for transient RPC failures ([6037bff](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6037bff297b32bf717663c5a452b23c825918378))
* add fee estimation endpoint POST /api/estimate-fee ([#224](https://github.com/Mossad-esc/stellar-footprint-engine/issues/224)) ([1fdf4a0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1fdf4a0ee215522363a1d31af61b0e38f2961c38))
* add fee estimation endpoint POST /api/estimate-fee ([#241](https://github.com/Mossad-esc/stellar-footprint-engine/issues/241)) ([8feef3d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8feef3d944fabc49f585641e439f9dc49418e892))
* add footprint diff endpoint POST /api/footprint/diff ([ce6925f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ce6925f774da68fe774da959e914dc89278489da))
* add footprint diff endpoint POST /api/footprint/diff ([770a21a](https://github.com/Mossad-esc/stellar-footprint-engine/commit/770a21a3ca90cf8b6c689543968ce38e5aca935c))
* add footprint parsing, TTL info, and optimization ([ee5b4e9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ee5b4e95a9e7615f1e36b55adf79272d94e497f6))
* add footprint parsing, TTL info, and optimization ([d50b151](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d50b151edaefb1200fb0fcb26773e177550a8b9d)), closes [#103](https://github.com/Mossad-esc/stellar-footprint-engine/issues/103) [#104](https://github.com/Mossad-esc/stellar-footprint-engine/issues/104) [#105](https://github.com/Mossad-esc/stellar-footprint-engine/issues/105) [#106](https://github.com/Mossad-esc/stellar-footprint-engine/issues/106)
* add footprint size analytics to simulation response ([53f26ba](https://github.com/Mossad-esc/stellar-footprint-engine/commit/53f26ba47490683cde30a27ac3871dc3a8117b17)), closes [#56](https://github.com/Mossad-esc/stellar-footprint-engine/issues/56)
* add Futurenet support as third network option ([508a076](https://github.com/Mossad-esc/stellar-footprint-engine/commit/508a076c36d30ff6fc097287c5c04aec03a83b3c)), closes [#26](https://github.com/Mossad-esc/stellar-footprint-engine/issues/26)
* add Futurenet support as third network option ([bcdf79b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/bcdf79b28f26070fbe94005eacdeccb9d1252fbc)), closes [#26](https://github.com/Mossad-esc/stellar-footprint-engine/issues/26)
* add Futurenet support as third network option ([#291](https://github.com/Mossad-esc/stellar-footprint-engine/issues/291)) ([bfb0c00](https://github.com/Mossad-esc/stellar-footprint-engine/commit/bfb0c00ff8345de93bb258c76e8442fce43c8c77)), closes [#26](https://github.com/Mossad-esc/stellar-footprint-engine/issues/26)
* add GitHub Actions CI pipeline with lint, typecheck, and test ([5525334](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5525334623fcd5000800720e9280fd7c6bd5e6dd))
* add GitHub Actions release workflow with Docker publish ([058aa17](https://github.com/Mossad-esc/stellar-footprint-engine/commit/058aa175067b18f2dbdfc39c32b159017bd837e9))
* add GitHub Actions release workflow with Docker publish ([dfae279](https://github.com/Mossad-esc/stellar-footprint-engine/commit/dfae279814b0387482712dc3f363031663f3c994))
* add GitHub Actions release workflow with Docker publish ([43bdaae](https://github.com/Mossad-esc/stellar-footprint-engine/commit/43bdaae93faaea2e6b739a9b3e04407681ee5f70)), closes [#117](https://github.com/Mossad-esc/stellar-footprint-engine/issues/117)
* add GitHub Actions release workflow with Docker publish ([#123](https://github.com/Mossad-esc/stellar-footprint-engine/issues/123) resolved) ([9b7b611](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9b7b6110c8c5093c31f65c75e528185dd6835c6c))
* add Grafana dashboard for service metrics ([dd1fdb5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/dd1fdb56279e32b41c699da527f904f879fb7d88))
* add Grafana dashboard for service metrics ([f89896a](https://github.com/Mossad-esc/stellar-footprint-engine/commit/f89896a25925294b0daf31d26c7273f077e31070)), closes [#37](https://github.com/Mossad-esc/stellar-footprint-engine/issues/37)
* add gzip compression, RPC connection pooling, request body logging, and ETag caching ([e2cfb15](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e2cfb15dbd7e795fecddff1528298b120f078a40))
* add gzip compression, RPC connection pooling, request body logging, and ETag caching ([#136](https://github.com/Mossad-esc/stellar-footprint-engine/issues/136) resolved) ([8da84bc](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8da84bc55cf9c82f84cdbab4afc260906fd47669))
* add Helmet.js security headers middleware ([508ef40](https://github.com/Mossad-esc/stellar-footprint-engine/commit/508ef408011480c2a79b43e554dac9194ca5448e))
* add Kubernetes deployment manifests with HPA ([#286](https://github.com/Mossad-esc/stellar-footprint-engine/issues/286)) ([50ff50b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/50ff50b37b2f8bb3ecb0bbd70b83809c013cfb37))
* add ledger entry restoration endpoint POST /api/restore ([d88c6e7](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d88c6e7ce6934894be5bfc0689714fb9e2a70faf))
* add ledger entry restoration endpoint POST /api/restore ([#258](https://github.com/Mossad-esc/stellar-footprint-engine/issues/258)) ([c78ef79](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c78ef7963f8d081ee1932319e857200ef9d7a487))
* add ledgerSequence validation in simulate endpoint ([077a8b9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/077a8b95a9f3dbc34144a7fea4c483f20e54fcb4))
* add ledgerSequence validation in simulate endpoint ([004c605](https://github.com/Mossad-esc/stellar-footprint-engine/commit/004c60570e3cf9ff2967527a1806c898acb1b05a)), closes [#103](https://github.com/Mossad-esc/stellar-footprint-engine/issues/103)
* add LRU cache for simulation results with TTL ([943e078](https://github.com/Mossad-esc/stellar-footprint-engine/commit/943e07886fbc8814a081baefd90b3bfd75e0fb0a))
* add LRU cache for simulation results with TTL ([#229](https://github.com/Mossad-esc/stellar-footprint-engine/issues/229)) ([9b762d2](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9b762d2029389f31ca0d2074b6f412f9d0d389f0))
* add LRU cache for simulation results with TTL ([#246](https://github.com/Mossad-esc/stellar-footprint-engine/issues/246)) ([0706ffa](https://github.com/Mossad-esc/stellar-footprint-engine/commit/0706ffaabfe1d456979eb523c589f7b8d1741e26))
* add machine-readable error codes and propagate structured API error codes ([1004094](https://github.com/Mossad-esc/stellar-footprint-engine/commit/100409433f9f4d5423a7f16e39efc7e4206693c1))
* add OpenAPI 3.0 spec, Swagger UI, .env.example, and integration tests ([8efcfbb](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8efcfbb76551ca901383e007dd55905e02063a57))
* add OpenAPI 3.0 spec, Swagger UI, .env.example, and integration tests ([436cb06](https://github.com/Mossad-esc/stellar-footprint-engine/commit/436cb06ff7d2588d1f756dbbd2620a07ff046daf))
* add OpenAPI endpoint, XDR size metric, and v0 envelope upgrade ([6c211c3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6c211c3f32c109ac3847785bd80af692103c31b6))
* add OpenAPI endpoint, XDR size metric, and v0 envelope upgrade ([054f7d5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/054f7d5271143d44b96ee43a4e6ce5828e77e937))
* add OpenAPI spec, .env.example, and simulate integration tests (conflict resolved) ([dbf8fd9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/dbf8fd953b64818ded39412b01495338ab732ddc))
* add optional ledger sequence parameter to simulation ([e2554d0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e2554d0c37c4b2bedbb289fbc05952d83fcc4d15))
* add optional ledger sequence parameter to simulation ([#146](https://github.com/Mossad-esc/stellar-footprint-engine/issues/146) resolved) ([b70127f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b70127f2f82e27589d032e436ef6ff926beda3a4))
* add optional ledger sequence parameter to simulation ([#264](https://github.com/Mossad-esc/stellar-footprint-engine/issues/264)) ([10677b3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/10677b31381d5f1a8e75308bd54b91e6badd7933))
* add optional Redis-backed counter store for brute-force middleware ([1228ff4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1228ff4131f5a14f36c872806d6af719f93e0d17))
* add optional Redis-backed counter store for brute-force middleware ([c0bae64](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c0bae64bf3ab948541f809ef581f74133a2248d9))
* add per-IP rate limiting to simulation endpoint ([#228](https://github.com/Mossad-esc/stellar-footprint-engine/issues/228)) ([0ada61b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/0ada61bf8f56d786271586515e33d939e6f57414))
* add per-IP rate limiting to simulation endpoint ([#245](https://github.com/Mossad-esc/stellar-footprint-engine/issues/245)) ([62a3410](https://github.com/Mossad-esc/stellar-footprint-engine/commit/62a3410e97b3c7fec28cc75f1b41daf8bc5443e5))
* add PM2 ecosystem config for production VPS deployment ([3abc16e](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3abc16e6b9964fb9305d3c60498d4081b786eff8))
* add PM2 ecosystem config for production VPS deployment ([b2fa748](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b2fa748c637ddbdb761302165eee249bd6b6b0c3)), closes [#118](https://github.com/Mossad-esc/stellar-footprint-engine/issues/118)
* add rate limiting to /decode and /estimate-fee endpoints ([3727596](https://github.com/Mossad-esc/stellar-footprint-engine/commit/372759685c481c2160240b94aa0634b6d99cee27))
* add rate limiting to /decode and /estimate-fee endpoints ([31cea5b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/31cea5bb3cf20ad1dc7a31e882a63da3a13f63a3)), closes [#346](https://github.com/Mossad-esc/stellar-footprint-engine/issues/346)
* add request ID middleware for distributed tracing ([2b61e65](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2b61e6507712befe78da56aed0c983b84d018cac)), closes [#27](https://github.com/Mossad-esc/stellar-footprint-engine/issues/27)
* add request ID middleware for distributed tracing ([1f267ce](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1f267cec050a6a9aa1f667bf9f7bdf7f19cff41d)), closes [#27](https://github.com/Mossad-esc/stellar-footprint-engine/issues/27)
* add request ID middleware for distributed tracing ([#292](https://github.com/Mossad-esc/stellar-footprint-engine/issues/292)) ([1098534](https://github.com/Mossad-esc/stellar-footprint-engine/commit/109853416b6f108a3aea482cc0778faf78d33c23)), closes [#27](https://github.com/Mossad-esc/stellar-footprint-engine/issues/27)
* add SEP-41 token contract detection to simulation response ([c1a5221](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c1a5221ca4917921bb23bc82cee38ddc6ce5909a)), closes [#113](https://github.com/Mossad-esc/stellar-footprint-engine/issues/113)
* add SEP-41 token contract detection to simulation response ([#138](https://github.com/Mossad-esc/stellar-footprint-engine/issues/138) resolved) ([cdf17dc](https://github.com/Mossad-esc/stellar-footprint-engine/commit/cdf17dcc24f747cb507d07b7acaa64ee72c12a6f))
* add SEP-41 token contract detection to simulation response ([#270](https://github.com/Mossad-esc/stellar-footprint-engine/issues/270)) ([ea120e5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ea120e55a620fdf425dc025358706fa590e5c9f0))
* add separate liveness and readiness health endpoints ([fbaa293](https://github.com/Mossad-esc/stellar-footprint-engine/commit/fbaa293c508b76cd59b46afd4f59dff59aa931b0))
* add separate liveness and readiness health endpoints ([6db15f1](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6db15f1e24a69121351e8194087b10bf4248f3c9)), closes [#412](https://github.com/Mossad-esc/stellar-footprint-engine/issues/412)
* add smart fee calculation using live network fee parameters ([fb23024](https://github.com/Mossad-esc/stellar-footprint-engine/commit/fb230247e3012386311ca45a0229b4cc2f15a70d))
* add smart fee calculation using live network fee parameters ([8717fc0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8717fc0b68a37385032d07f1ab8f2d39c194060c))
* add startup env var validation with zod ([da7e222](https://github.com/Mossad-esc/stellar-footprint-engine/commit/da7e2222db6e4d3dc6144e06cbea8fb532faf428))
* add startup env var validation with zod ([78f9742](https://github.com/Mossad-esc/stellar-footprint-engine/commit/78f9742987649035ac1ab929f69114da809ad2d1))
* add structured JSON logging with pino ([35fb9e5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/35fb9e5d96a6b6a716e9d9482ccf8cb4d3b8e42a))
* add structured JSON logging with pino ([9546a0e](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9546a0ecb2b9718290e70182d119eef002b526d1)), closes [#28](https://github.com/Mossad-esc/stellar-footprint-engine/issues/28)
* add TypeScript path aliases for cleaner imports ([#204](https://github.com/Mossad-esc/stellar-footprint-engine/issues/204)) ([04ab774](https://github.com/Mossad-esc/stellar-footprint-engine/commit/04ab774275f1ff3c250808f0f5d10d11936ee481))
* add TypeScript path aliases for cleaner imports ([#242](https://github.com/Mossad-esc/stellar-footprint-engine/issues/242)) ([9992f76](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9992f76e3a07291e48ae3139bd7d305721c019b7))
* add webhook support for async simulation results ([#207](https://github.com/Mossad-esc/stellar-footprint-engine/issues/207)) ([d6e4f5c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d6e4f5c6b5e3103f2971bbfe999631e486b780c3))
* add webhook support for async simulation results ([#239](https://github.com/Mossad-esc/stellar-footprint-engine/issues/239)) ([cc62bfd](https://github.com/Mossad-esc/stellar-footprint-engine/commit/cc62bfd5d5fed9bd0160f1e20cbeee899d4ffe13))
* add X-RateLimit-* headers to rate-limited responses ([d495c95](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d495c955bde691a38f44e4c673704f4369306acc))
* add X-RateLimit-* headers to rate-limited responses ([9fb3012](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9fb30124dbffddcb53861a295ce29c7c87a98e34))
* add XDR decoder endpoint GET /api/decode ([#226](https://github.com/Mossad-esc/stellar-footprint-engine/issues/226)) ([92ebb99](https://github.com/Mossad-esc/stellar-footprint-engine/commit/92ebb99946573ba65b4e57582ea974db7d6c8818))
* add XDR decoder endpoint GET /api/decode ([#243](https://github.com/Mossad-esc/stellar-footprint-engine/issues/243)) ([a67765c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/a67765c690ff2803708263d7e5f5385ef1810979))
* add XDR validation endpoint POST /api/validate ([e898e7b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e898e7b038e3baa1ddf99c433bed9caebee0dfbe)), closes [#114](https://github.com/Mossad-esc/stellar-footprint-engine/issues/114)
* add XDR validation endpoint POST /api/validate ([#139](https://github.com/Mossad-esc/stellar-footprint-engine/issues/139) resolved) ([50f1fcd](https://github.com/Mossad-esc/stellar-footprint-engine/commit/50f1fcd4f972380a2d7855e9391705cb1c28c645))
* add XDR validation endpoint POST /api/validate ([#271](https://github.com/Mossad-esc/stellar-footprint-engine/issues/271)) ([975459f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/975459f5d89a2c6b1224be90f0f2088305c62b5a))
* **api:** implement POST /api/v1/validate and restore network check ([ac22f94](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ac22f94f48eba1ee65f305ad8f30734e11950a53))
* **api:** wire async webhook simulation delivery and job status route ([81833b9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/81833b9005510dc6db2f5568b06a610c02573bae))
* client disconnect abort, i18n, circuit breaker Retry-After, batch concurrency ([8899718](https://github.com/Mossad-esc/stellar-footprint-engine/commit/88997189b01084e69310716fa313c11d0afc2d74))
* client disconnect abort, i18n, Retry-After, batch concurrency ([d5c2a9d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d5c2a9d70257e745bd55c26f3bd6def1ef675334))
* decode and return contract invocation details in response ([73b6b8f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/73b6b8f19ffc4d3dd0978ef8c686d755b3b0b9d7)), closes [#55](https://github.com/Mossad-esc/stellar-footprint-engine/issues/55)
* disable all browser features via Permissions-Policy header ([196b2f2](https://github.com/Mossad-esc/stellar-footprint-engine/commit/196b2f2cf28e30b10e53d007248f485b2a1400a3))
* **dx:** add testnet seed script, pre-push hook, and vscode config ([#155](https://github.com/Mossad-esc/stellar-footprint-engine/issues/155)) ([096c6ab](https://github.com/Mossad-esc/stellar-footprint-engine/commit/096c6abd8fd53499ee48d6e536116aae29c8d9ed))
* **dx:** add tx factory, coverage gate, and otel tracing ([#168](https://github.com/Mossad-esc/stellar-footprint-engine/issues/168)) ([e84f778](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e84f778b3fbe7e8945244951ef665a47651076d3))
* extract and return Soroban auth entries from simulation ([eb93bdf](https://github.com/Mossad-esc/stellar-footprint-engine/commit/eb93bdffcb568567d751734392f369c2a87a717e)), closes [#53](https://github.com/Mossad-esc/stellar-footprint-engine/issues/53)
* extract and return Soroban contract events from simulation ([e521857](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e521857c0b18c1154cdaead05c2c012dc152b4ba)), closes [#54](https://github.com/Mossad-esc/stellar-footprint-engine/issues/54)
* extract required signers for multi-sig transactions ([a6fb067](https://github.com/Mossad-esc/stellar-footprint-engine/commit/a6fb06741eb2bbb5661bf718d2c8f3463afa0332))
* extract required signers for multi-sig transactions ([cdec110](https://github.com/Mossad-esc/stellar-footprint-engine/commit/cdec11062dcb427c8bab8b8566f42314c72337f9))
* idempotency keys, cache-stats, footprint histograms, simulatedAt ([33301fe](https://github.com/Mossad-esc/stellar-footprint-engine/commit/33301fe2d3993b85aa690199a56bf32ab0e234aa))
* idempotency keys, cache-stats, footprint histograms, simulatedAt ([e04c8c9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e04c8c956419eac6b61dc442bc4ebb9281136754))
* implement [#359](https://github.com/Mossad-esc/stellar-footprint-engine/issues/359) [#360](https://github.com/Mossad-esc/stellar-footprint-engine/issues/360) [#361](https://github.com/Mossad-esc/stellar-footprint-engine/issues/361) [#362](https://github.com/Mossad-esc/stellar-footprint-engine/issues/362) multi-issue improvements ([2f5d8e4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2f5d8e4b88d4a8d770fa9b567f0d5aebd98396c2))
* implement footprint diff endpoint ([6dcd175](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6dcd175fd435f0bc9807b715735846f6bb4a6c4f))
* implement issues [#330](https://github.com/Mossad-esc/stellar-footprint-engine/issues/330) [#331](https://github.com/Mossad-esc/stellar-footprint-engine/issues/331) [#332](https://github.com/Mossad-esc/stellar-footprint-engine/issues/332) [#333](https://github.com/Mossad-esc/stellar-footprint-engine/issues/333) ([2eafeba](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2eafebaa466d0b6b9c571a2122577006b06ee39a))
* implement issues [#330](https://github.com/Mossad-esc/stellar-footprint-engine/issues/330) [#331](https://github.com/Mossad-esc/stellar-footprint-engine/issues/331) [#332](https://github.com/Mossad-esc/stellar-footprint-engine/issues/332) [#333](https://github.com/Mossad-esc/stellar-footprint-engine/issues/333) ([c435c41](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c435c4147657a9b51d075edc567de00dc8e05849))
* implement XDR validation endpoint ([0d99f8f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/0d99f8fe57a9cb996c73212c678b5586f3892aeb))
* implement XDR validation endpoint ([5a480ee](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5a480ee1518f54cd27d668edf566e7fefd889869))
* **infra:** align k8s probes, PM2 graceful reload, and nginx TLS proxy ([#165](https://github.com/Mossad-esc/stellar-footprint-engine/issues/165)) ([298b2a5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/298b2a502498c8e0acc8cfe04d4c2ec09c79952a))
* integrate restore endpoint, circuit breaker, api versioning, an… ([#249](https://github.com/Mossad-esc/stellar-footprint-engine/issues/249)) ([30f2f71](https://github.com/Mossad-esc/stellar-footprint-engine/commit/30f2f71e5f2b3e2ad719056e922ccb07608d0543))
* mega-merge - consolidate all pending features and fixes ([#209](https://github.com/Mossad-esc/stellar-footprint-engine/issues/209)) ([0117e60](https://github.com/Mossad-esc/stellar-footprint-engine/commit/0117e60214fe251971aa8c2483a70ed9a3311720))
* **monitoring:** add grafana panels, prometheus alerts, and stryker mutation testing ([#164](https://github.com/Mossad-esc/stellar-footprint-engine/issues/164)) ([9363843](https://github.com/Mossad-esc/stellar-footprint-engine/commit/936384361480971af918883e7e3c24c776d0c456))
* parallelise TTL/contract, SWR cache, cold-start reduction, CircuitBreaker tests ([1767f93](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1767f93d31731f9943525dc466af5c7c0ef84038))
* resolve issues [#335](https://github.com/Mossad-esc/stellar-footprint-engine/issues/335) [#336](https://github.com/Mossad-esc/stellar-footprint-engine/issues/336) [#337](https://github.com/Mossad-esc/stellar-footprint-engine/issues/337) [#338](https://github.com/Mossad-esc/stellar-footprint-engine/issues/338) ([051c35d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/051c35d81a8c192002bc23d1cd0291aeef1e3de3))
* resolve issues [#335](https://github.com/Mossad-esc/stellar-footprint-engine/issues/335) [#336](https://github.com/Mossad-esc/stellar-footprint-engine/issues/336) [#337](https://github.com/Mossad-esc/stellar-footprint-engine/issues/337) [#338](https://github.com/Mossad-esc/stellar-footprint-engine/issues/338) ([c4dd59f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c4dd59f00610ba887b45ccdf1d989e5e241bcff3))
* resolve issues [#339](https://github.com/Mossad-esc/stellar-footprint-engine/issues/339) [#340](https://github.com/Mossad-esc/stellar-footprint-engine/issues/340) [#341](https://github.com/Mossad-esc/stellar-footprint-engine/issues/341) [#342](https://github.com/Mossad-esc/stellar-footprint-engine/issues/342) ([40acaef](https://github.com/Mossad-esc/stellar-footprint-engine/commit/40acaefdc6dd77b973b9b190ab5d9d44db3c40b1))
* resolve issues [#339](https://github.com/Mossad-esc/stellar-footprint-engine/issues/339) [#340](https://github.com/Mossad-esc/stellar-footprint-engine/issues/340) [#341](https://github.com/Mossad-esc/stellar-footprint-engine/issues/341) [#342](https://github.com/Mossad-esc/stellar-footprint-engine/issues/342) ([c69d0ef](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c69d0ef712d0d27d1edb431fee0babfb30986ef5))
* **sdk,dx:** add official TS SDK, Bruno/Postman sync, and devcontainer ([#157](https://github.com/Mossad-esc/stellar-footprint-engine/issues/157)) ([2832421](https://github.com/Mossad-esc/stellar-footprint-engine/commit/283242152bb0b8550b6e925e799980299d23e21e))
* set up Jest with ts-jest for TypeScript testing ([62a7837](https://github.com/Mossad-esc/stellar-footprint-engine/commit/62a78377b3e523ec68a6d202216d95ccd493d3ca))
* set up Jest with ts-jest for TypeScript testing ([9c7c804](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9c7c80405db2764902f89e7bb4dcc1ff7ebff8f0))
* ttl warnings, multi-op cost aggregation, network http metrics, supported-networks endpoint ([7b47e00](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7b47e00572ded66ed7ee4bc14939e039bb78a851))
* ttl warnings, multi-op cost aggregation, network http metrics, supported-networks endpoint ([7100781](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7100781fb1c51c97fc15c3a94d19fc782f42a424))
* validate webhookUrl is HTTPS to prevent SSRF and secret leakage ([ccb1c2b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ccb1c2b7c1738fd08ae4080e70abc49f825533d2))
* **webhook:** validate webhookUrl as HTTPS and add webhook tests ([d7c75ff](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d7c75ffe0aed4ae03159b006505597a8f4b5ec6b))


### Bug Fixes

* add GET /api/health endpoint for liveness checks ([#194](https://github.com/Mossad-esc/stellar-footprint-engine/issues/194)) ([128a058](https://github.com/Mossad-esc/stellar-footprint-engine/commit/128a0581a9e1cd3fceedc038c8000b53c7a0e53f))
* add GET /api/health endpoint for liveness checks ([#194](https://github.com/Mossad-esc/stellar-footprint-engine/issues/194)) ([e3f3fd3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e3f3fd36c42f09040559c041cec8816ca84d228c))
* allow-http config, body size limit, port validation, rpc timeout ([1ea2a57](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1ea2a57d8c676653e1ac71e725d22ce474a493f2))
* allow-http config, body size limit, port validation, rpc timeout ([#289](https://github.com/Mossad-esc/stellar-footprint-engine/issues/289)) ([dfef3cc](https://github.com/Mossad-esc/stellar-footprint-engine/commit/dfef3ccb0001165020350fe2e81756b5c5992775))
* correct Soroban footprints restoration fees and constructor simulation ([#138](https://github.com/Mossad-esc/stellar-footprint-engine/issues/138)) ([123cb68](https://github.com/Mossad-esc/stellar-footprint-engine/commit/123cb6810912e919a6d275d529b891748e04c1b9))
* document REDIS_URL, add invalid_transaction type, batch ledgerSe… ([1afdd72](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1afdd7217e67fd6360aa02a266cbe7524de6835f))
* document REDIS_URL, add invalid_transaction type, batch ledgerSequence, futurenet support ([1b82edb](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1b82edb502c2b7fe62bcaba8fb6b9dc29fa8fbf0))
* downgrade uuid to v9 (CJS) to fix ESM Jest parse error in CI ([2a572b4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2a572b4425d09e0f6ad4a98e034b10e7ad3199c1))
* **infra:** repair lockfile, security audit, and upstream CI regressions ([00d3e7b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/00d3e7b90ebd191d5b6e775d8a4c02f1c17c4c41))
* lazy config load, sanitize RPC errors, error type discrimination, CORS middleware ([2e00788](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2e0078877d4cf3d6bc309e36bbf51be01f8ba512))
* lazy config load, sanitize RPC errors, error type discrimination, CORS middleware ([#290](https://github.com/Mossad-esc/stellar-footprint-engine/issues/290)) ([5d3887b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5d3887b745e98fc92d4e3ec512218d78597a3acf))
* merge all branches into main + restore CI fixes ([b53ad89](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b53ad89213161af3c341ad921a27d15d7f7ea3e3))
* merge all branches into main + restore CI fixes ([b53ad89](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b53ad89213161af3c341ad921a27d15d7f7ea3e3))
* merge footprints and expose asset and storage metadata ([#140](https://github.com/Mossad-esc/stellar-footprint-engine/issues/140)) ([7e68c18](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7e68c18235e8ee28af53a0df06e4891fe23e053d)), closes [#6](https://github.com/Mossad-esc/stellar-footprint-engine/issues/6) [#7](https://github.com/Mossad-esc/stellar-footprint-engine/issues/7) [#8](https://github.com/Mossad-esc/stellar-footprint-engine/issues/8) [#11](https://github.com/Mossad-esc/stellar-footprint-engine/issues/11)
* **middleware:** harden apiKeyAuth with timing-safe verification and tests ([ff35fc0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ff35fc02248d076a3bbe6919f7218dac50c36354))
* opt into Node.js 24 for GitHub Actions ([2ce3403](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2ce3403db87589e28f13fc0c4ad02df363d93d14))
* regenerate broken pnpm-lock.yaml ([aa21314](https://github.com/Mossad-esc/stellar-footprint-engine/commit/aa21314303db7cb2ef8274cbeb37e6d8bca64a93))
* regenerate broken pnpm-lock.yaml after merge conflicts ([ac5b6d7](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ac5b6d783246a9589510c1c970cd64ee01bf5ba4))
* reject invalid network values with 400 response ([5330e58](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5330e5820fe4447cf6ff6dcc5fcdfe713f33c85d))
* reject invalid network values with 400 response ([2391b46](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2391b46cc5bb09ca461c6d3eea3a6f711802fc50))
* remove duplicate POST /simulate/batch route registration ([293c357](https://github.com/Mossad-esc/stellar-footprint-engine/commit/293c3575c97cde950ee401c6c61fd0e35ea54aed))
* remove duplicate POST /simulate/batch route registration ([df9066c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/df9066cce272ccf5e957b481acb25c9323583b20))
* resolve all CI failures (lint, tests, coverage, Express 5 routes, uuid ESM, mock fixes) ([9558626](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9558626e493fa7dae122c62ad1d580873d7c7e87))
* resolve all TypeScript strict mode errors ([#196](https://github.com/Mossad-esc/stellar-footprint-engine/issues/196)) ([5b0a9d6](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5b0a9d6489913a361bd370622e2b5a62ac334504))
* resolve all TypeScript strict mode errors ([#196](https://github.com/Mossad-esc/stellar-footprint-engine/issues/196)) ([9bb1f09](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9bb1f099a92b06318c027c08c2c925e454f1f42c))
* resolve CI failures - TS errors, SDK v15, missing deps, duplicate code ([cadec31](https://github.com/Mossad-esc/stellar-footprint-engine/commit/cadec3197c6b4b2c67ea47d4571cc66c83e9f4f4))
* resolve conflicts in Dockerfile and healthcheck.js for PR [#156](https://github.com/Mossad-esc/stellar-footprint-engine/issues/156) ([b97a213](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b97a213ca5c137eeed2705f330d05e988843ce7f))
* resolve issues [#322](https://github.com/Mossad-esc/stellar-footprint-engine/issues/322), [#323](https://github.com/Mossad-esc/stellar-footprint-engine/issues/323), [#343](https://github.com/Mossad-esc/stellar-footprint-engine/issues/343), [#345](https://github.com/Mossad-esc/stellar-footprint-engine/issues/345) ([cae3e15](https://github.com/Mossad-esc/stellar-footprint-engine/commit/cae3e15e9ec2ebc1ffc9202d190cd1e00c8bf535))
* resolve issues [#322](https://github.com/Mossad-esc/stellar-footprint-engine/issues/322), [#323](https://github.com/Mossad-esc/stellar-footprint-engine/issues/323), [#343](https://github.com/Mossad-esc/stellar-footprint-engine/issues/343), [#345](https://github.com/Mossad-esc/stellar-footprint-engine/issues/345) ([031b5e3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/031b5e38e3a5bec52479a916e800d95e0b5efbcc))
* resolve PromiseRejectionHandledWarning in retry test with Jest 30 fake timers ([113eb9c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/113eb9c8a902c57f89bb72e116e80d9d19effdc3))
* resolve retry test failure with Jest 30 fake timers ([dd7999d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/dd7999d75539ebd8e4d6efb15ce1e8b5f4fd4117))
* resolve TypeScript errors, SDK v15 API changes, duplicate code, missing deps ([b62f75a](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b62f75a163164035e4c95f33417c78f1e23849ef))
* restore CI checks and type-safe decoding ([a041169](https://github.com/Mossad-esc/stellar-footprint-engine/commit/a041169c75352f650269362ed9c35abb7e1233a5))
* restore CI checks and type-safe decoding ([071314f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/071314fb11b9921842234c5f501bc9f3d6d5363c))
* restore CI fixes after branch merges (jest config, tests, mocks, routes) ([5d70335](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5d703356f41ba3a817cb9c51cfc72f2da2b66d5b))
* show TTL and authorization details for Soroban transactions ([#139](https://github.com/Mossad-esc/stellar-footprint-engine/issues/139)) ([1c29804](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1c29804d373d9ea38ede6814e2b915f2b102f9d4))
* strengthen Content-Security-Policy header configuration ([57fe868](https://github.com/Mossad-esc/stellar-footprint-engine/commit/57fe868ede5ee1e62e8a5a7efb76e24be651ccf5))
* strengthen Content-Security-Policy header configuration\n\nCloses [#33](https://github.com/Mossad-esc/stellar-footprint-engine/issues/33) ([4642420](https://github.com/Mossad-esc/stellar-footprint-engine/commit/464242038e6b465511323185fb962720019b3e49))
* strip internal raw field from HTTP responses ([a4e77ce](https://github.com/Mossad-esc/stellar-footprint-engine/commit/a4e77ced05bf995aa7166b2812df63a0b73ffd5b)), closes [#4](https://github.com/Mossad-esc/stellar-footprint-engine/issues/4)
* strip internal raw field from HTTP responses ([#148](https://github.com/Mossad-esc/stellar-footprint-engine/issues/148) resolved) ([6812d4c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6812d4c90abbef18134246d01f99a7dbfa8b4323))
* strip internal raw field from HTTP responses ([#263](https://github.com/Mossad-esc/stellar-footprint-engine/issues/263)) ([65282d7](https://github.com/Mossad-esc/stellar-footprint-engine/commit/65282d71276f92d7b8003ce103a55dca55b14a99))
* surface empty footprint as error instead of silent success ([9967aa4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9967aa46d53f159f994bffcc456edec715b14bba))
* surface empty footprint as error instead of silent success ([42627db](https://github.com/Mossad-esc/stellar-footprint-engine/commit/42627dba69d02e5a4c231c7c6295a453c3eea21b)), closes [#3](https://github.com/Mossad-esc/stellar-footprint-engine/issues/3)
* unhandled rejection, remove unused secretKey, Soroban op validation, graceful shutdown ([#279](https://github.com/Mossad-esc/stellar-footprint-engine/issues/279)) ([59bf764](https://github.com/Mossad-esc/stellar-footprint-engine/commit/59bf76406ac4add2690e7fadd78411ac07ab3d83))
* update CI workflow to use pnpm instead of npm ([#210](https://github.com/Mossad-esc/stellar-footprint-engine/issues/210)) ([8d276bf](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8d276bf9115339968b7ebf43900d8d9750339bc0))
* use node:22-alpine for LTS compatibility ([6a956fb](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6a956fb7c46dbd1c620362b98c00fb44fd124375))
* wire simulation result caching into simulateTransaction ([50738fd](https://github.com/Mossad-esc/stellar-footprint-engine/commit/50738fd91a0bd6b577d9b6028f18a79d5930590e))
* wire simulation result caching into simulateTransaction ([f0aca32](https://github.com/Mossad-esc/stellar-footprint-engine/commit/f0aca32b8c995a5752d2c7e1c942f87ae48e6839))
* X-Cache header correctly reflects cache hit after simulation caching ([68aecae](https://github.com/Mossad-esc/stellar-footprint-engine/commit/68aecae0f75524dc8c48bc8ae56600549abf336f))


### Performance Improvements

* base64 length formula + Redis latency histogram ([102ead3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/102ead3eaab793cf7a7cf0d708f395fdf0fbd72c))
* base64 length formula + Redis latency histogram ([6ec950e](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6ec950e462eb7afa58166c92a998f7c95d475e44))
* keep-alive timeouts + configurable network status cache TTL ([e7dda28](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e7dda281469483ece6aad217b1a078887d07afd6))
* keep-alive timeouts + configurable network status cache TTL ([7ad7700](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7ad7700be81dc5cacd15331a80179a0ef0217ef7))


### Miscellaneous

* add .editorconfig for consistent editor settings ([#282](https://github.com/Mossad-esc/stellar-footprint-engine/issues/282)) ([ba63230](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ba632306006a38c62ecfe63e4f9136a2fe7f71de))
* add clean and build:clean scripts ([208177a](https://github.com/Mossad-esc/stellar-footprint-engine/commit/208177ad19793739d57c5dfe80a2c41ac840da4c))
* add env:check script to validate required environment variables ([1696b0e](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1696b0ec7caf77364a6451db5a3ac78a64343f48))
* automate CHANGELOG generation with release-please ([1dc6097](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1dc6097ef66f593a8f23d88f377109eadc30f394))
* **ci:** add node matrix, trivy scan, and memory leak test ([#162](https://github.com/Mossad-esc/stellar-footprint-engine/issues/162)) ([edc2473](https://github.com/Mossad-esc/stellar-footprint-engine/commit/edc2473bed0a85802b4fbd6a873b4453e6e37f20))
* **ci:** configure dependabot automerge, release-please, and benchmarks ([#160](https://github.com/Mossad-esc/stellar-footprint-engine/issues/160)) ([7c065d7](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7c065d785d922b091ebb63c8cddc1daeb76c4b0e))
* **deps-dev:** bump @commitlint/cli from 19.8.1 to 20.5.3 ([3358a87](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3358a87cb5a940684cd22f5234fc2d673b94e657))
* **deps-dev:** bump @commitlint/cli from 19.8.1 to 20.5.3 ([3b20fc6](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3b20fc626e9afacd6da0c248644ca961e428e8f5))
* **deps-dev:** bump @commitlint/cli from 20.5.3 to 21.0.1 ([d8381f4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d8381f4ddff9a6be7eb3fab1ab2ba289be39565a))
* **deps-dev:** bump @commitlint/cli from 20.5.3 to 21.0.1 ([8ae76ad](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8ae76adab4495c2507a7f0a1ba9d6ae2c59064ab))
* **deps-dev:** bump @commitlint/config-conventional ([39466c8](https://github.com/Mossad-esc/stellar-footprint-engine/commit/39466c827cefcc1c8aa44cf0c1595833c073a40b))
* **deps-dev:** bump @commitlint/config-conventional ([afee3bd](https://github.com/Mossad-esc/stellar-footprint-engine/commit/afee3bd9b14174973a5306182ecf42a342e28a25))
* **deps-dev:** bump @commitlint/config-conventional from 19.8.1 to 20.5.3 ([2a9c814](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2a9c814326c96ce45ed12e78af83ba45ce38a7fc))
* **deps-dev:** bump @commitlint/config-conventional from 19.8.1 to 21.0.1 ([2cabeb9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/2cabeb943f53c8709a7633deb86c8b7621b77fac))
* **deps-dev:** bump @types/node from 20.19.39 to 25.6.0 ([807ddbe](https://github.com/Mossad-esc/stellar-footprint-engine/commit/807ddbedac4c884d399e16eb913f937207abc696))
* **deps-dev:** bump @types/node from 20.19.39 to 25.6.0 ([0fdd419](https://github.com/Mossad-esc/stellar-footprint-engine/commit/0fdd419adba4318165b0f9c3d258454fb2a4461d))
* **deps-dev:** bump @types/node from 24.12.2 to 25.6.0 ([#221](https://github.com/Mossad-esc/stellar-footprint-engine/issues/221)) ([a94d97b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/a94d97bef57618d0ce5f1337a8d0feb67fc01a78))
* **deps-dev:** bump @typescript-eslint/parser from 8.58.2 to 8.59.0 ([ed17c4c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ed17c4c26b92c0deded5a5cec6e46c23dcfb5cfc))
* **deps-dev:** bump @typescript-eslint/parser from 8.58.2 to 8.59.0 ([9b755f0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9b755f0a63b2c7264199b53fb84c29afa5fb3efe))
* **deps-dev:** bump jest from 30.3.0 to 30.4.0 ([1fc8069](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1fc8069b8f8cf7459e06779ce22ca6a7b1d60a31))
* **deps-dev:** bump jest from 30.3.0 to 30.4.0 ([1a04138](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1a04138e65149a836590ebd207dddeb24ad22e10))
* **deps-dev:** bump lint-staged from 16.4.0 to 17.0.5 ([5b37fbe](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5b37fbeb3e8503a51dc3843ecdbea66765dd8e11))
* **deps-dev:** bump lint-staged from 16.4.0 to 17.0.5 ([ba42b4c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ba42b4c0933953d29eb493a4b8cc4b44e59abe5b))
* **deps-dev:** bump typescript from 5.9.3 to 6.0.3 ([59d906f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/59d906f96002e9f2310b835302b262df78ebdc82))
* **deps-dev:** bump typescript from 5.9.3 to 6.0.3 ([1b9ef91](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1b9ef913026407b22d646231f25a087be93c7d44))
* **deps:** bump @stellar/stellar-sdk from 15.0.1 to 15.1.0 ([47bbe32](https://github.com/Mossad-esc/stellar-footprint-engine/commit/47bbe326e69b9ff8d9f3e83b5cbec893d9d62a44))
* **deps:** bump @stellar/stellar-sdk from 15.0.1 to 15.1.0 ([7319754](https://github.com/Mossad-esc/stellar-footprint-engine/commit/73197543489953883a6420b8d5454a89ea36e4a9))
* **deps:** bump @stellar/stellar-sdk to ^15.0.1 ([#217](https://github.com/Mossad-esc/stellar-footprint-engine/issues/217)) ([5f13708](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5f137086e8340a42ab67ea655c1ae5cbea98d84a))
* **deps:** bump actions/cache from 4 to 5 ([#216](https://github.com/Mossad-esc/stellar-footprint-engine/issues/216)) ([c166e0d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c166e0d170de3fdcca30f780a9675e133e32d497))
* **deps:** bump actions/setup-node from 4 to 6 ([77126fb](https://github.com/Mossad-esc/stellar-footprint-engine/commit/77126fbe5cf3854d6d8871199a459d64bec70fa2))
* **deps:** bump actions/setup-node from 4 to 6 ([fbf2249](https://github.com/Mossad-esc/stellar-footprint-engine/commit/fbf2249f3448ceef097210e159e970f5bf9a3af5))
* **deps:** bump actions/setup-node from 4 to 6 ([7ee4036](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7ee4036772b2b127f968800741cff809f3b35624))
* **deps:** bump actions/setup-node from 4 to 6 ([7d4e190](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7d4e19076e3f25658878283b524566babaad0e43))
* **deps:** bump actions/setup-node from 4 to 6 ([#212](https://github.com/Mossad-esc/stellar-footprint-engine/issues/212)) ([8b740d4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8b740d43ae49f2933b1df665adf2f37331e85eb0))
* **deps:** bump dependabot/fetch-metadata from 2 to 3 ([54c9997](https://github.com/Mossad-esc/stellar-footprint-engine/commit/54c9997437df8379a0187ed1a7d80f2c4214afa6))
* **deps:** bump dependabot/fetch-metadata from 2 to 3 ([c146ecc](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c146ecc834852a47b703e603688b0030d10d90e7))
* **deps:** bump docker/build-push-action from 5 to 7 ([3f12198](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3f121987818991c937bbb1bca35eb34268fb2aff))
* **deps:** bump docker/build-push-action from 5 to 7 ([36b04ae](https://github.com/Mossad-esc/stellar-footprint-engine/commit/36b04aed0b9df4fb17fd224f2a2610da9bf056a4))
* **deps:** bump docker/build-push-action from 5 to 7 ([#215](https://github.com/Mossad-esc/stellar-footprint-engine/issues/215)) ([8fdb6e9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8fdb6e98d709fe027d3452b582bd2f3d8fe11359))
* **deps:** bump docker/login-action from 3 to 4 ([#213](https://github.com/Mossad-esc/stellar-footprint-engine/issues/213)) ([ea4dea0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ea4dea0f4f03ca82f9763e3a0cb6fcc4ed01bc48))
* **deps:** bump docker/metadata-action from 5 to 6 ([8ce1b9f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8ce1b9f084bc399298805946097569df34c460b6))
* **deps:** bump docker/metadata-action from 5 to 6 ([f3003c0](https://github.com/Mossad-esc/stellar-footprint-engine/commit/f3003c0ff71b1a62b84327f34bf745e39198d531))
* **deps:** bump dotenv from 16.6.1 to 17.4.2 ([9538531](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9538531e4d72462f24681a429a361a2b0a788caf))
* **deps:** bump dotenv from 16.6.1 to 17.4.2 ([146bb1d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/146bb1dcc70e724c0b2000aec0fde44bc0892576))
* **deps:** bump dotenv to ^17.4.2 ([#219](https://github.com/Mossad-esc/stellar-footprint-engine/issues/219)) ([f505d98](https://github.com/Mossad-esc/stellar-footprint-engine/commit/f505d9837ab24af6c3c94bf88644e530b9b57e5d))
* **deps:** bump express and @types/express ([5e86918](https://github.com/Mossad-esc/stellar-footprint-engine/commit/5e869187b782d879b4f139a939b444105cd82f97))
* **deps:** bump express and @types/express ([c2edb1e](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c2edb1e36e7f1c29a3f11a39a6e814f71502a714))
* **deps:** bump express to ^5.2.1 ([#218](https://github.com/Mossad-esc/stellar-footprint-engine/issues/218)) ([366078c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/366078cb56cf1fea064c7787084af19b40d1d327))
* **deps:** bump github/codeql-action from 3 to 4 ([116f8ca](https://github.com/Mossad-esc/stellar-footprint-engine/commit/116f8ca4c2056bc711555fa667fa003ddc7cfbc2))
* **deps:** bump github/codeql-action from 3 to 4 ([9ec6293](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9ec62932df2218e6cf95b40c87efdb2cf689fc26))
* **deps:** bump googleapis/release-please-action from 4 to 5 ([d803872](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d80387200447b00636f72ce4102d40c7cff12a1c))
* **deps:** bump googleapis/release-please-action from 4 to 5 ([7204dfe](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7204dfe3a26aa3fa952ccefe18fe504ae15d552a))
* **deps:** bump lint-staged to 16.4.0 ([#220](https://github.com/Mossad-esc/stellar-footprint-engine/issues/220)) ([081860c](https://github.com/Mossad-esc/stellar-footprint-engine/commit/081860c8a77dd58063c7fa9fdf1f0ce177f11ff8))
* **deps:** bump pnpm/action-setup from 3 to 6 ([7da8a9e](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7da8a9e277169ce2df84d7bb6040c18bdd1afb3a))
* **deps:** bump pnpm/action-setup from 3 to 6 ([d487324](https://github.com/Mossad-esc/stellar-footprint-engine/commit/d487324467e4b69efabe570eff9c610fca052175))
* **deps:** bump pnpm/action-setup from 4 to 6 ([#214](https://github.com/Mossad-esc/stellar-footprint-engine/issues/214)) ([0f0a564](https://github.com/Mossad-esc/stellar-footprint-engine/commit/0f0a564a4d21b5160158ef6825d886d51889b317))
* **deps:** bump softprops/action-gh-release from 2 to 3 ([b0836bf](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b0836bfce0aae200d9f9dbaaada36c890e348b54))
* **deps:** bump softprops/action-gh-release from 2 to 3 ([7cd39f9](https://github.com/Mossad-esc/stellar-footprint-engine/commit/7cd39f9e2a998c86c16ffc6dfb8cd6552cd232d3))
* **deps:** bump zod from 4.3.6 to 4.4.3 ([fd7e748](https://github.com/Mossad-esc/stellar-footprint-engine/commit/fd7e748fffe89ab5a7d3317d23b758e10bc20d93))
* **deps:** bump zod from 4.3.6 to 4.4.3 ([ed50e1d](https://github.com/Mossad-esc/stellar-footprint-engine/commit/ed50e1d5a460cc3f16be496df99161c1d6c7f73d))
* **docs:** update repository references to stellar-footprint-engine ([870f910](https://github.com/Mossad-esc/stellar-footprint-engine/commit/870f9105efe8974f5a5e7b60e86b34718b76f691))
* DX improvements — ADR 002, env:check, clean scripts, and CHANGELOG automation ([bf029b3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/bf029b36fcd42f54b723f319ae8dbab38f8a2b3d))
* enforce 80% code coverage threshold in CI ([8c48d5b](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8c48d5b007d53ac8824c0d3d8a13e8f16e616bf2))
* enforce 80% code coverage threshold in CI ([777fe97](https://github.com/Mossad-esc/stellar-footprint-engine/commit/777fe973cf62e63507a88b8ea75dc89a4a257f02))
* extend .gitignore with __snapshots__/ and *.snap ([c69d0ef](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c69d0ef712d0d27d1edb431fee0babfb30986ef5))
* implement CI improvements and dependency management ([6669ddc](https://github.com/Mossad-esc/stellar-footprint-engine/commit/6669ddcc82abfc925d8e522e5b02f0793a86a0d6))
* implement CI improvements and dependency management ([#152](https://github.com/Mossad-esc/stellar-footprint-engine/issues/152) resolved) ([00b5b56](https://github.com/Mossad-esc/stellar-footprint-engine/commit/00b5b56e2b89a280952b86b3835437f3c815a341))
* **infra:** add load test mix, distroless dockerfile, and response snapshots ([#163](https://github.com/Mossad-esc/stellar-footprint-engine/issues/163)) ([1e13526](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1e13526a803759769111e82fc2d7c76715c2ccd0))
* merge feature/docker (main already contains this work) ([c744c48](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c744c48ea2a39129dec758f030cddf196f215a1d))
* merge feature/footprint-analytics (main already contains this work) ([9107ae4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9107ae4c0d7f182efa29285d8a8f07adf089eb99))
* merge feature/helmet-headers (main already contains this work) ([f849130](https://github.com/Mossad-esc/stellar-footprint-engine/commit/f8491309d93838ac9f4bf7e0659c8dea4e9e85c1))
* merge feature/restore-endpoint (main already contains this work) ([404cef5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/404cef5692747abb1de3d33899c9b22254256b38))
* merge fix/ci-typecheck-lint (main already contains this work) ([8d8cc95](https://github.com/Mossad-esc/stellar-footprint-engine/commit/8d8cc95437d76cb8c27a839b1afaa3698d3f4216))
* merge improvement/no-console-lint (main already contains this work) ([c293ea3](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c293ea3771994208e5f16ba8f132a0d5b251bf23))
* merge merge/pr-280 (main already contains this work) ([1134000](https://github.com/Mossad-esc/stellar-footprint-engine/commit/1134000a3f70e4774558bf2e8ee437e30519f3f2))
* merge merge/pr-281 (main already contains this work) ([86a79bf](https://github.com/Mossad-esc/stellar-footprint-engine/commit/86a79bffbf7857499a428e3da7a90bf1a37e3729))
* merge merge/pr-287 (main already contains this work) ([91b5f9f](https://github.com/Mossad-esc/stellar-footprint-engine/commit/91b5f9fc0990eec14d001c85cecefae3dd635129))
* merge merge/pr-288 (main already contains this work) ([658bcfe](https://github.com/Mossad-esc/stellar-footprint-engine/commit/658bcfe8919fdf4f306ab28fb6255f468cde36d5))
* regenerate pnpm-lock.yaml to fix CI lockfile parsing error ([b75a8eb](https://github.com/Mossad-esc/stellar-footprint-engine/commit/b75a8eb906133beedcefada25e7ee5a029797c05))
* update CI pipeline to use pnpm ([809f7e4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/809f7e4a8e553419811daa41bdefa79c4c5a7513))
* update docs, tests, cache, load-test and fix merge conflicts ([447ff31](https://github.com/Mossad-esc/stellar-footprint-engine/commit/447ff310c7915a1814e81083a25453dfc21523a3))


### Code Refactoring

* **config:** replace static configs with createNetworkConfig() f… ([3efab95](https://github.com/Mossad-esc/stellar-footprint-engine/commit/3efab950fd3fb888c8eb90c867b366d9f7ffb276))
* **config:** replace static configs with createNetworkConfig() factory ([#75](https://github.com/Mossad-esc/stellar-footprint-engine/issues/75)) ([e4e58ea](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e4e58ea0daddfee54df05568ec1e65e94a9368a6))
* consolidate single-op and multi-op simulation paths ([181d068](https://github.com/Mossad-esc/stellar-footprint-engine/commit/181d068247c8c2ac5abeb41b7ed894f964cf4026))
* consolidate single-op and multi-op simulation paths ([e925d69](https://github.com/Mossad-esc/stellar-footprint-engine/commit/e925d695e12fad53d99aeed44b183e211255db6e))
* extract XDR input validation into shared utility ([c40dab4](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c40dab4f63e8b3b127fd09eda021b03f0fa57b42))
* extract XDR input validation into shared utility ([76248f5](https://github.com/Mossad-esc/stellar-footprint-engine/commit/76248f5b9b70dc4d5ce29c54c17a549f561b4961))
* move inline constants from simulator.ts to constants.ts ([c2feffd](https://github.com/Mossad-esc/stellar-footprint-engine/commit/c2feffd36b26e5157d0b1166b9ce4cbbc2dd8f75)), closes [#410](https://github.com/Mossad-esc/stellar-footprint-engine/issues/410)
* replace any type casts with proper types in simulator.ts ([9aef554](https://github.com/Mossad-esc/stellar-footprint-engine/commit/9aef554e8b11b324c7ea064a0986e6e68824170f)), closes [#408](https://github.com/Mossad-esc/stellar-footprint-engine/issues/408)

## [Unreleased]

## [1.0.0] - 2025-01-01

### Added

- `POST /api/simulate` endpoint — accepts base64-encoded transaction XDR and returns optimized footprint and resource costs
- Stellar Soroban transaction simulation via `@stellar/stellar-sdk`
- Footprint extraction: parses `read_only` and `read_write` ledger keys from simulation results
- Footprint optimization — removes unnecessary ledger entries from the footprint
- Resource cost estimation — returns `cpuInsns` and `memBytes` from simulation response
- Support for both `testnet` and `mainnet` networks via request body `network` field
- XDR parsing and decoding utilities
- Redis-backed response caching for identical XDR inputs
- Prometheus metrics middleware (`/metrics` endpoint)
- Request timeout middleware with configurable `SIMULATE_TIMEOUT_MS`
- Rate limiting middleware with configurable thresholds
- Brute-force protection middleware with IP-level delay and blocking
- IP allowlist and blocklist middleware via `IP_ALLOWLIST` / `IP_BLOCKLIST` env vars
- Circuit breaker for RPC calls with configurable failure threshold and recovery window
- Request logging middleware
- Response time tracking middleware
- Content-type validation middleware
- Graceful error handling with structured JSON error responses
- Health check endpoint (`/health`) and `healthcheck.js` script for Docker
- Docker support: `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`
- Nginx reverse proxy configuration with TLS support
- PM2 process manager configuration via `ecosystem.config.js`
- Grafana dashboard and Prometheus scrape configuration under `monitoring/`
- Conventional Commits enforcement via `commitlint` and Husky pre-commit/pre-push hooks
- Branch name validation via `validate-branch-name`
- ESLint and Prettier configuration for consistent code style
- TypeScript strict mode with `tsconfig.json`
- Jest test suite with unit, integration, and smoke tests
- Load testing script via `autocannon` (`scripts/load-test.js`)
- Environment variable reference in `.env.example`
- Deployment guide for Railway, Render, Fly.io, and bare VPS with PM2 (`docs/deployment.md`)
- Postman collection for API testing (`docs/postman/`)
- Architecture Decision Record for caching strategy (`docs/adr/001-caching-strategy.md`)
- Contributor guide (`CONTRIBUTING.md`)

### Security

- Secret keys are never logged or returned in API responses
- IP-level brute-force blocking to prevent abuse
- Configurable IP allowlist to restrict access to trusted clients
- Circuit breaker prevents cascading failures from RPC outages

[Unreleased]: https://github.com/Mossad-esc/stellar-footprint-engine/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Mossad-esc/stellar-footprint-engine/releases/tag/v1.0.0
