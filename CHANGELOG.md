# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-31

### Added

- `Utf8KeyIndex`: maps string keys to sequential index numbers (`0, 1, 2, …`)
  without holding string objects on the JS heap. Stores UTF-8 key bytes, end
  offsets, 32-bit FNV-1a hashes and an open-addressed hash table in typed
  arrays (`Uint8Array` and `Int32Array`), with zero-allocation ASCII lookup
  (`get`, `has`, `add`, `trim`, `size`, `byteLength`).

## [0.2.0] - 2026-10-28

### Added

- `NdjsonStream`: reads one stream as consecutive sections with
  `readLine({ maxBytes })`, `batches(byteLength)` and `batches()` (to the end
  of the stream). It carries the bytes that cross each section boundary over
  to the next read, so callers no longer pass a `rest` from one call to the
  next. A failed read, or leaving a section before its end, cancels the
  stream.
- `BoundedLineBatcher.rest`: the bytes pushed past the part's end, which
  belong to whatever follows it.
- `readFirstLine` accepts `leading` bytes, scanned before the reader is read.

## [0.1.0] - 2026-10-20

### Added

- Initial release: `readFirstLine`, `boundedBatches`, `LineBatcher`,
  `BoundedLineBatcher`, `LineStore`, `ByteStringSearchIndex`,
  `GrowableInt32Array`, `NdjsonError`, `toByteString`, `concat`, `NEWLINE`
  and `yieldToMain`.

[0.3.0]: https://github.com/saunos/ndjson-index/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/saunos/ndjson-index/compare/6941bff...v0.2.0
[0.1.0]: https://github.com/saunos/ndjson-index/commit/6941bff
