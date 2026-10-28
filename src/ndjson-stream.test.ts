import { describe, expect, it } from 'bun:test';

import { NEWLINE } from './bytes';
import { NdjsonError } from './errors';
import { NdjsonStream } from './NdjsonStream';
import { chunkedStream, collect, encode, join } from './test-utils';

// A manifest line, then two parts it declares by byte length: the shape of
// an entry-table file.
const entries = '{"id":"a"}\n{"id":"bcd"}\n';
const relationships = '{"id":"r1","from":"a"}\n';
const manifest = JSON.stringify({ bytes: 24, relationships: { bytes: 23 } });
const file = encode(`${manifest}\n${entries}${relationships}`);

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('NdjsonStream', () => {
  it('reads a line, a declared part, then the rest, at any chunking', async () => {
    for (const chunkSize of [1, 3, 7, 64, file.byteLength]) {
      const { stream, log } = chunkedStream(file, chunkSize);
      const src = new NdjsonStream(stream, { batchBytes: 4 });

      const m = JSON.parse(await src.readLine({ maxBytes: 1024 })) as { bytes: number };
      const a = await collect(src.batches(m.bytes));
      expect(log.cancelled).toBe(false);
      const b = await collect(src.batches());

      expect(join(a)).toEqual(encode(entries));
      expect(join(b)).toEqual(encode(relationships));
      expect([...a, ...b].every((batch) => batch.at(-1) === NEWLINE)).toBe(true);
      // The stream ended on its own, so there was nothing left to cancel at
      // the source; what counts is that this object is now closed.
      await expect(src.readLine({ maxBytes: 1024 })).rejects.toThrow('closed');
    }
  });

  it('reads two declared parts back to back', async () => {
    const src = new NdjsonStream(chunkedStream(file, 5).stream, { batchBytes: 4 });
    const m = JSON.parse(await src.readLine({ maxBytes: 1024 })) as {
      bytes: number;
      relationships: { bytes: number };
    };
    expect(join(await collect(src.batches(m.bytes)))).toEqual(encode(entries));
    expect(join(await collect(src.batches(m.relationships.bytes)))).toEqual(encode(relationships));
    expect(await collect(src.batches())).toEqual([]);
  });

  it('reads consecutive lines from one chunk', async () => {
    const src = new NdjsonStream(chunkedStream(encode('one\ntwo\nthree'), 64).stream, {
      batchBytes: 4,
    });
    expect(await src.readLine({ maxBytes: 16 })).toBe('one');
    expect(await src.readLine({ maxBytes: 16 })).toBe('two');
    expect((await collect(src.batches())).map(decode)).toEqual(['three']);
  });

  it('gives an empty part no batches and keeps what follows', async () => {
    const src = new NdjsonStream(chunkedStream(encode('h\nrest\n'), 64).stream, {
      batchBytes: 4,
    });
    await src.readLine({ maxBytes: 16 });
    expect(await collect(src.batches(0))).toEqual([]);
    expect((await collect(src.batches())).map(decode)).toEqual(['rest\n']);
  });

  it('cancels the stream when a section is left early, and refuses further reads', async () => {
    const { stream, log } = chunkedStream(file, 4);
    const src = new NdjsonStream(stream, { batchBytes: 1 });
    await src.readLine({ maxBytes: 1024 });
    for await (const _ of src.batches(24)) break;
    expect(log.cancelled).toBe(true);
    await expect(src.readLine({ maxBytes: 1024 })).rejects.toThrow('closed');
  });

  it('refuses a second read while one is in progress', async () => {
    const src = new NdjsonStream(chunkedStream(file, 4).stream, { batchBytes: 1 });
    await src.readLine({ maxBytes: 1024 });
    const section = src.batches(24);
    await section.next();
    await expect(src.readLine({ maxBytes: 1024 })).rejects.toThrow('in progress');
    await section.return();
  });

  it('cancels the stream when a declared part is cut short', async () => {
    const { stream } = chunkedStream(encode(`${manifest}\n{"id":"a"}\n`), 4);
    const src = new NdjsonStream(stream, { batchBytes: 4 });
    await src.readLine({ maxBytes: 1024 });
    const error = await collect(src.batches(24)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NdjsonError);
    expect(error).toMatchObject({ code: 'truncated', offset: 11 });
    await expect(src.readLine({ maxBytes: 1024 })).rejects.toThrow('closed');
  });

  it('cancels the stream when a declared part is malformed mid-stream', async () => {
    // The declared length (5) does not end on a newline, and bytes follow,
    // so the source is still open when the error is found.
    const { stream, log } = chunkedStream(file, 4);
    const src = new NdjsonStream(stream, { batchBytes: 4 });
    await src.readLine({ maxBytes: 1024 });
    const error = await collect(src.batches(5)).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'not-on-line-boundary' });
    expect(log.cancelled).toBe(true);
  });
});
