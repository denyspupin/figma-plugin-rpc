# Changelog

## [1.2.0](https://github.com/denyspupin/figma-plugin-rpc/compare/v1.1.0...v1.2.0) (2026-08-14)


### Features

* **server:** add composable middleware support ([#32](https://github.com/denyspupin/figma-plugin-rpc/issues/32)) ([7b909a6](https://github.com/denyspupin/figma-plugin-rpc/commit/7b909a643f5f22e1f4c9aa251677654906814b2c))

## [1.1.0](https://github.com/denyspupin/figma-plugin-rpc/compare/v1.0.0...v1.1.0) (2026-08-08)


### Features

* **client:** centralize pending-call settlement with single-settlement guarantee ([#23](https://github.com/denyspupin/figma-plugin-rpc/issues/23)) ([5bf1821](https://github.com/denyspupin/figma-plugin-rpc/commit/5bf1821ccbf302c90906dd271099ae5f5d9bbd05))
* **protocol:** add deep protocol decoding with sound type predicates ([#22](https://github.com/denyspupin/figma-plugin-rpc/issues/22)) ([7700800](https://github.com/denyspupin/figma-plugin-rpc/commit/7700800c6817f1df14e7ad320024905b97cf30f7))
* **server:** safe handler dispatch with Map storage and error containment ([29bd766](https://github.com/denyspupin/figma-plugin-rpc/commit/29bd766984a91cfd4d00bd8f0997e619f3689b9c))
* **transport:** validate message source in FigmaUiTransport ([#24](https://github.com/denyspupin/figma-plugin-rpc/issues/24)) ([6a27001](https://github.com/denyspupin/figma-plugin-rpc/commit/6a27001c322073cd6c05ebb2f06f659f529801a6))
* **types:** repair schema type contract with closed name preservation ([#25](https://github.com/denyspupin/figma-plugin-rpc/issues/25)) ([39254a8](https://github.com/denyspupin/figma-plugin-rpc/commit/39254a8d810420c40c45da917dac375bf5f2b0d5))


### Bug Fixes

* **protocol:** preserve malformed message correlation ([#31](https://github.com/denyspupin/figma-plugin-rpc/issues/31)) ([b2923f7](https://github.com/denyspupin/figma-plugin-rpc/commit/b2923f7bf42d01aaf866b7ab25b2434fda2be9a3))
* resolve 1.1 release blockers ([#30](https://github.com/denyspupin/figma-plugin-rpc/issues/30)) ([e19dc2d](https://github.com/denyspupin/figma-plugin-rpc/commit/e19dc2d5bbd510f55c9a7e8e4d9d05c0b09cf33d))

## [1.0.0](https://github.com/denyspupin/figma-plugin-rpc/compare/v0.3.0...v1.0.0) (2026-08-07)


### Migration Notes (v0.3.0 → v1.0)

**FigmaMainTransport**: Now uses `figma.ui.on('message', cb)` / `figma.ui.off('message', cb)` instead of the `figma.ui.onmessage` setter. Behavior is unchanged for consumers who only use this library. Consumers who manually set `figma.ui.onmessage` are no longer wrapped (they were before) — this is strictly safer.

## [0.3.0](https://github.com/denyspupin/figma-plugin-rpc/compare/v0.2.2...v0.3.0) (2026-08-07)


### Features

* initial scaffold — type-safe RPC for Figma plugins ([7601e21](https://github.com/denyspupin/figma-plugin-rpc/commit/7601e2150e32f3e1ca13a3bae7cf29e25b0a7f42))


### Bug Fixes

* bump Node.js to 22 for jsdom 30 compatibility ([a37f28c](https://github.com/denyspupin/figma-plugin-rpc/commit/a37f28c7c219685bdf26d2841ca372b460312e97))
* explicitly configure npm auth token ([69a09ad](https://github.com/denyspupin/figma-plugin-rpc/commit/69a09ad401ca61b6a3de43072ef3e67a61362269))
* harden transports, tighten API surface, wire husky (v0.2.0) ([9f4d7d8](https://github.com/denyspupin/figma-plugin-rpc/commit/9f4d7d861fa56bd95a8657388f0d3c516d21ceea))
* remove provenance flag to test npm publish ([6739310](https://github.com/denyspupin/figma-plugin-rpc/commit/673931027f3b8addae91571f1813fef461f538a2))

## [0.2.2](https://github.com/denyspupin/figma-plugin-rpc/compare/v0.2.1...v0.2.2) (2026-08-04)


### Bug Fixes

* bump Node.js to 22 for jsdom 30 compatibility ([a37f28c](https://github.com/denyspupin/figma-plugin-rpc/commit/a37f28c7c219685bdf26d2841ca372b460312e97))

## Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
