import { BoundedLineBatcher } from './BoundedLineBatcher';

interface BoundedBatchesOptions {
  /** How many bytes the part has; it must end on a newline. */
  byteLength: number;
  /** Batch size goal in bytes; see `LineBatcher`. */
  batchBytes: number;
  /**
   * Bytes of the part already read from `reader`, such as the `rest` that
   * `readFirstLine` returns. They come first.
   */
  leading?: Uint8Array | null;
}

/**
 * Reads the next `byteLength` bytes of a stream and yields them as batches of
 * whole lines, in order; they add up to exactly `byteLength`. Each batch owns
 * its buffer, so it may be kept or transferred.
 *
 * Reading is pull-based: the stream is read only when the caller asks for the
 * next batch, so a caller that is still processing the last batch holds the
 * download back. That is the backpressure; nothing else bounds memory.
 *
 * However it ends (done, thrown, or the caller stopping early), the reader is
 * cancelled, so whatever follows the part is never fetched.
 *
 * @throws {NdjsonError} `not-on-line-boundary` if the part does not end on a
 *   newline, or `truncated` if the stream ends inside it
 */
export async function* boundedBatches(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  { byteLength, batchBytes, leading = null }: BoundedBatchesOptions,
): AsyncGenerator<Uint8Array<ArrayBuffer>, void, undefined> {
  const part = new BoundedLineBatcher(byteLength, batchBytes);
  try {
    if (leading != null) yield* part.push(leading);
    while (!part.complete) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* part.push(value);
    }
    part.end();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
