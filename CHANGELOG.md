# Changelog

## [0.4.0](https://github.com/denyspupin/figma-plugin-rpc/compare/v0.3.0...v0.4.0) (2026-08-07)


### Features

* add AbortSignal support to call() ([b88f52c](https://github.com/denyspupin/figma-plugin-rpc/commit/b88f52c176e3f474cb04c0f67c3e6b64b83e0753))
* add pluggable runtime validation for RPC server ([4737236](https://github.com/denyspupin/figma-plugin-rpc/commit/47372369a44a8240279dcc1f762d0ebbc004a1c8))
* add protocol version field to RPC messages ([401cb7b](https://github.com/denyspupin/figma-plugin-rpc/commit/401cb7be224a05585c312a4052f4b0aa4819d4e6))
* add structured typed errors ([1ffef80](https://github.com/denyspupin/figma-plugin-rpc/commit/1ffef80c8e98d33a2f43fd91e81707ea102543df))

## [Unreleased]

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
