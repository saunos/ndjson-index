# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/saunos/ndjson-index/compare/6941bff...v0.2.0
[0.1.0]: https://github.com/saunos/ndjson-index/commit/6941bff
