import { describe, expect, it } from 'bun:test';

import { boundedBatches } from './bounded-batches';
import { NEWLINE } from './bytes';
import { NdjsonError } from './errors';
import { readFirstLine } from './read-first-line';
import { chunkedStream, collect, encode, join } from './test-utils';

const header = '{"bytes":24}';
const part = '{"id":"a"}\n{"id":"bcd"}\n';
const trailer = '{"rel":1}\n';
const file = encode(`${header}\n${part}${trailer}`);

/** Reads line 1, then the declared part, from `chunkSize`-byte chunks. */
async function readPart(data: Uint8Array, chunkSize: number, batchBytes = 4) {
  const { stream, log } = chunkedStream(data, chunkSize);
  const reader = stream.getReader();
  const { line, rest } = await readFirstLine(reader, { maxBytes: 1024 });
  const { bytes } = JSON.parse(line) as { bytes: number };
  const batches = await collect(
    boundedBatches(reader, { byteLength: bytes, batchBytes, leading: rest }),
  );
  return { line, batches, log };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (error instanceof NdjsonError) return error.code;
    throw error;
  }
}

describe('readFirstLine + boundedBatches', () => {
  it('reads the header, then exactly the declared part, then cancels', async () => {
    for (const chunkSize of [1, 3, 7, 64, file.byteLength]) {
      const { line, batches, log } = await readPart(file, chunkSize);
      expect(line).toBe(header);
      expect(join(batches)).toEqual(encode(part));
      expect(batches.every((b) => b.at(-1) === NEWLINE)).toBe(true);
      expect(log.cancelled).toBe(true);
    }
  });

  it('keeps a line longer than the batch size whole', async () => {
    const { batches } = await readPart(file, 5, 1);
    expect(batches.map((b) => new TextDecoder().decode(b))).toEqual([
      '{"id":"a"}\n',
      '{"id":"bcd"}\n',
    ]);
  });

  it('yields nothing for an empty part', async () => {
    const { batches } = await readPart(encode('{"bytes":0}\nrest\n'), 4);
    expect(batches).toEqual([]);
  });

  it('reads nothing past line 1 until a batch is asked for', async () => {
    const big = encode(`${'{"bytes":4000}'}\n${'{"x":1}\n'.repeat(500)}`);
    const { stream, log } = chunkedStream(big, 16);
    const reader = stream.getReader();
    const { rest } = await readFirstLine(reader, { maxBytes: 1024 });
    const pullsAfterHeader = log.pulls;

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log.pulls).toBe(pullsAfterHeader);

    const batches = boundedBatches(reader, {
      byteLength: 4000,
      batchBytes: 64,
      leading: rest,
    });
    await batches.next();
    expect(log.pulls).toBeGreaterThan(pullsAfterHeader);
    expect(log.pulls * 16).toBeLessThan(big.byteLength);
    await batches.return();
    expect(log.cancelled).toBe(true);
  });

  it('fails when line 1 never ends', async () => {
    const { stream } = chunkedStream(encode('no newline here'), 4);
    expect(await codeOf(readFirstLine(stream.getReader(), { maxBytes: 1024 }))).toBe('no-newline');
  });

  it('gives up on a line 1 longer than maxBytes', async () => {
    const { stream, log } = chunkedStream(new Uint8Array(1000).fill(65), 10);
    expect(await codeOf(readFirstLine(stream.getReader(), { maxBytes: 100 }))).toBe(
      'line-too-long',
    );
    // At most one chunk past the cap was read.
    expect(log.pulls).toBeLessThanOrEqual(11);
  });

  it('fails when the declared part does not end on a newline', async () => {
    const data = encode(`{"bytes":5}\n${part}`);
    expect(await codeOf(readPart(data, 4))).toBe('not-on-line-boundary');
  });

  it('fails when the stream ends inside the part', async () => {
    const data = encode(`{"bytes":24}\n{"id":"a"}\n`);
    const error = await readPart(data, 4).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NdjsonError);
    expect(error).toMatchObject({ code: 'truncated', offset: 11 });
  });
});
