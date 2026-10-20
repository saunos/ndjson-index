# @saunos/ndjson-index

Stream, batch and index huge NDJSON files in the browser without holding them on the JS heap.

Built for files of hundreds of MB, such as a diff of 500k records, that a page must page through and search without a database and without freezing:

- **Backpressure.** The download is read only when you ask for the next batch.
- **Off-heap storage.** Lines live in `Blob`s; the heap holds three integers per line.
- **Compact search.** Text is kept as one-byte-per-char "byte strings" and searched with the native `indexOf`.
- **Never blocks input.** Long work yields to the event loop between ~1 MB slices.

No runtime dependencies. Needs ES2024 (resizable `ArrayBuffer`); uses `scheduler.yield()` where available.

```sh
npm install @saunos/ndjson-index
```

## Example

A file whose first line is a header declaring how many bytes of records follow:

```ts
import {
  ByteStringSearchIndex,
  LineStore,
  boundedBatches,
  readFirstLine,
} from '@saunos/ndjson-index';

const reader = (await fetch(url)).body!.getReader();
const { line, rest } = await readFirstLine(reader, { maxBytes: 1 << 20 });
const header = JSON.parse(line);

const lines = new LineStore();
const search = new ByteStringSearchIndex();

for await (const batch of boundedBatches(reader, {
  byteLength: header.bytes,
  batchBytes: 8 << 20,
  leading: rest,
})) {
  await lines.append(batch, {
    line: (text) => search.append(valuesOf(JSON.parse(text))),
    sliceEnd: () => search.seal(),
  });
}

const hits = await search.search('иванов'); // ascending line numbers
const first = JSON.parse(await lines.read(hits[0]));
```

## API

| Export | What it does |
| --- | --- |
| `readFirstLine(reader, { maxBytes })` | Reads and decodes line 1 only; returns it and the bytes read past it. |
| `boundedBatches(reader, { byteLength, batchBytes, leading })` | Yields the next `byteLength` bytes as newline-aligned batches, then cancels the reader. |
| `LineBatcher` / `BoundedLineBatcher` | The synchronous chunk-to-batch cutters behind it. |
| `LineStore` | Blob-backed line storage: `append(batch, visitor)`, `read(n)`, `length`, `dispose()`. |
| `ByteStringSearchIndex` | Case-insensitive substring index: `append(values)`, `seal()`, `search(needle)`. |
| `GrowableInt32Array` | Push-only `Int32Array` on a resizable `ArrayBuffer`. |
| `toByteString(bytes)` | Bytes → one-byte-per-char string. |
| `yieldToMain()` | Yields to the event loop (`scheduler.yield`, else `MessageChannel`). |
| `NdjsonError` | Thrown with a `code` when the stream's shape is wrong. |

## Development

```sh
bun install
bun run tsc && bun run lint && bun run fmt && bun test && bun run build
```

## License

MIT
