import { BoundedLineBatcher } from './BoundedLineBatcher';
import { LineBatcher } from './LineBatcher';
import { readFirstLine } from './read-first-line';

interface NdjsonStreamOptions {
  /** Batch size goal in bytes; see `LineBatcher`. */
  batchBytes: number;
}

/**
 * Reads one NDJSON stream as consecutive sections: a line, a part of a
 * declared byte length, then another, then the rest, each handled its own
 * way.
 *
 * A network read rarely ends where a section does, so the chunk that crosses
 * a boundary holds bytes of the next section. This class keeps them (a
 * pushback buffer, as in Go's `bufio.Reader`) and hands them to whichever
 * read comes next, so a caller never threads a `rest` from one call to the
 * following one.
 *
 * Reads run one at a time, in order. Reading is pull-based throughout, as in
 * {@link boundedBatches}: nothing is fetched until a line or batch is asked
 * for.
 *
 * The stream is cancelled when a read fails, when a caller stops iterating a
 * section before its end (the bytes left in it would otherwise be read as the
 * next section), when the section to the end of the stream is done, or on
 * {@link cancel}. After that, every read throws.
 *
 * @example
 * const src = new NdjsonStream(response.body!, { batchBytes: 8 << 20 });
 * const manifest = JSON.parse(await src.readLine({ maxBytes: 1 << 20 }));
 * for await (const batch of src.batches(manifest.bytes)) processEntries(batch);
 * for await (const batch of src.batches()) processRest(batch);
 */
export class NdjsonStream {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly batchBytes: number;
  /** Bytes read from the stream that no section has consumed yet. */
  private pending: Uint8Array | null = null;
  private busy = false;
  private closed = false;

  /** Locks `stream`: from now on only this object reads it. */
  constructor(stream: ReadableStream<Uint8Array>, { batchBytes }: NdjsonStreamOptions) {
    this.reader = stream.getReader();
    this.batchBytes = batchBytes;
  }

  /**
   * Reads up to the next newline and decodes that line.
   *
   * @returns the line without its newline
   * @throws {NdjsonError} as {@link readFirstLine}; the stream is cancelled
   * @throws {Error} if the stream is closed or another read is in progress
   */
  async readLine({ maxBytes }: { maxBytes: number }): Promise<string> {
    this.claim();
    try {
      const { line, rest } = await readFirstLine(this.reader, {
        maxBytes,
        leading: this.take(),
      });
      this.pending = rest;
      return line;
    } catch (error) {
      await this.cancel();
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Yields the next section as batches of whole lines, in order. Each batch
   * owns its buffer, so it may be kept or transferred.
   *
   * @param byteLength the section's length, which must end on a newline.
   *   Omitted, the section runs to the end of the stream, whose last line
   *   may lack its newline, and the stream is closed after it.
   * @throws {NdjsonError} as {@link boundedBatches} for a bounded section;
   *   the stream is cancelled
   * @throws {Error} if the stream is closed or another read is in progress
   */
  async *batches(byteLength?: number): AsyncGenerator<Uint8Array<ArrayBuffer>, void, undefined> {
    // A generator's body, this check included, runs on the first `next()`,
    // not at the call: two sections may be created up front and read in turn.
    this.claim();
    let finished = false;
    try {
      yield* byteLength == null ? this.toEnd() : this.bounded(byteLength);
      finished = true;
    } finally {
      this.busy = false;
      if (!finished || byteLength == null) await this.cancel();
    }
  }

  /** Stops reading and cancels the stream. Safe to call more than once. */
  async cancel(): Promise<void> {
    this.closed = true;
    this.pending = null;
    await this.reader.cancel().catch(() => undefined);
  }

  private async *bounded(byteLength: number): AsyncGenerator<Uint8Array<ArrayBuffer>> {
    const part = new BoundedLineBatcher(byteLength, this.batchBytes);
    const leading = this.take();
    if (leading != null) yield* part.push(leading);
    while (!part.complete) {
      const { done, value } = await this.reader.read();
      if (done) break;
      yield* part.push(value);
    }
    part.end();
    this.pending = part.rest;
  }

  private async *toEnd(): AsyncGenerator<Uint8Array<ArrayBuffer>> {
    const batcher = new LineBatcher(this.batchBytes);
    const leading = this.take();
    if (leading != null) {
      const batch = batcher.push(leading);
      if (batch != null) yield batch;
    }
    for (;;) {
      const { done, value } = await this.reader.read();
      if (done) break;
      const batch = batcher.push(value);
      if (batch != null) yield batch;
    }
    const last = batcher.end();
    if (last != null) yield last;
  }

  /** Starts a read, or throws if one cannot start now. */
  private claim(): void {
    if (this.closed) throw new Error('NdjsonStream is closed');
    if (this.busy) throw new Error('NdjsonStream: another read is in progress');
    this.busy = true;
  }

  /** Hands over the pushed-back bytes, leaving none. */
  private take(): Uint8Array | null {
    const bytes = this.pending;
    this.pending = null;
    return bytes;
  }
}
