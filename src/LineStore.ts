import { NEWLINE } from './bytes';
import { GrowableInt32Array } from './GrowableInt32Array';
import { yieldToMain } from './yield-to-main';

/**
 * Bytes decoded between yields to the event loop. Decoding and a typical
 * per-line `JSON.parse` run at a few hundred MB/s, so a slice costs a few
 * milliseconds: well under the 50 ms after which the browser counts a task as
 * long and input starts to lag.
 */
const DEFAULT_SLICE_BYTES = 1 << 20;

/** What {@link LineStore.append} reports while it indexes a batch. */
export interface LineVisitor {
  /**
   * Called once per non-empty line, in order.
   *
   * @param text the line, decoded, without its newline
   * @param index the line's number in the store, counted from zero
   * @throws to reject the batch; see {@link LineStore.append}
   */
  line(text: string, index: number): void;
  /**
   * Called after the lines of each slice (about `sliceBytes` of input), just
   * before the store yields to the event loop. A natural point to close a
   * `ByteStringSearchIndex` segment.
   */
  sliceEnd?(): void;
}

interface LineStoreOptions {
  /** Bytes decoded between yields; see {@link DEFAULT_SLICE_BYTES}. */
  sliceBytes?: number;
}

/**
 * Holds many NDJSON lines outside the JS heap and reads any one of them back
 * by number.
 *
 * Each appended batch of lines moves into a `Blob`, which the browser keeps
 * outside the JS heap (and may page to disk). Per line the store keeps only
 * three integers in typed arrays: which blob holds it, and where it starts and
 * ends. So a 500 MB file costs the heap a few MB of indexes, and reading a line
 * back is one `Blob.slice().text()`.
 *
 * Lines are numbered by arrival, counting only non-empty ones.
 */
export class LineStore {
  private readonly sliceBytes: number;
  /** The batches as appended; a line is read back out of one of them. */
  private batches: Blob[] = [];
  /** Per line, indexed by line number: which of {@link batches} holds it. */
  private lineBatch = new GrowableInt32Array();
  /** Per line: where it starts in its batch. */
  private lineStart = new GrowableInt32Array();
  /** Per line: where it ends in its batch (exclusive, before the newline). */
  private lineEnd = new GrowableInt32Array();
  private disposed = false;

  constructor({ sliceBytes = DEFAULT_SLICE_BYTES }: LineStoreOptions = {}) {
    this.sliceBytes = sliceBytes;
  }

  /** How many lines the store holds. */
  get length(): number {
    return this.lineStart.length;
  }

  /**
   * Indexes the next batch of lines, about `sliceBytes` at a time, yielding to
   * the event loop between slices, then moves the batch into a `Blob`.
   *
   * Lines are numbered by arrival, so each call must be awaited before the
   * next.
   *
   * @param bytes whole lines (the last may lack its newline); copied into the
   *   `Blob`, so the caller may reuse them afterwards
   * @param visitor told about every line, see {@link LineVisitor}
   * @throws whatever `visitor` throws. The lines indexed before it threw stay
   *   numbered but can no longer be read, so a store that rejected a batch
   *   should be disposed.
   * @throws {Error} once disposed
   */
  async append(bytes: Uint8Array<ArrayBuffer>, visitor: LineVisitor): Promise<void> {
    this.assertOpen();
    const batch = this.batches.length;
    const decoder = new TextDecoder();

    let sliceStart = 0;
    while (sliceStart < bytes.byteLength) {
      // Extend the slice to the end of the line it stops in, so no line is
      // split between two slices.
      const newline = bytes.indexOf(
        NEWLINE,
        Math.min(sliceStart + this.sliceBytes, bytes.byteLength) - 1,
      );
      const sliceEnd = newline === -1 ? bytes.byteLength : newline + 1;
      this.indexSlice(bytes.subarray(sliceStart, sliceEnd), batch, sliceStart, decoder, visitor);
      visitor.sliceEnd?.();
      sliceStart = sliceEnd;
      if (sliceStart < bytes.byteLength) await yieldToMain();
    }
    this.batches.push(new Blob([bytes]));
  }

  /**
   * Reads one line back. Reading from a `Blob` is asynchronous, so read the
   * lines of a page in parallel.
   *
   * @throws {RangeError} if no line has that number
   * @throws {Error} once disposed
   */
  async read(index: number): Promise<string> {
    this.assertOpen();
    const batch = this.batches[this.lineBatch.at(index)];
    if (batch == null) {
      // Indexed by a batch whose visitor threw, so its bytes were not kept.
      throw new RangeError(`Line ${index} belongs to a rejected batch`);
    }
    return batch.slice(this.lineStart.at(index), this.lineEnd.at(index)).text();
  }

  /**
   * Drops every reference, so the bytes and indexes can be collected. Safe to
   * call more than once; any later call to the store throws.
   */
  dispose(): void {
    this.disposed = true;
    this.batches = [];
    this.lineBatch = new GrowableInt32Array(0);
    this.lineStart = new GrowableInt32Array(0);
    this.lineEnd = new GrowableInt32Array(0);
  }

  /**
   * Records each line of `slice`, which starts at byte `offset` of batch
   * number `batch`, and hands it to `visitor`.
   *
   * The slice is decoded to one string and split on newlines; UTF-8 never
   * uses the newline byte inside a multi-byte character, so the n-th string
   * piece is the n-th byte range found by scanning for `\n`.
   */
  private indexSlice(
    slice: Uint8Array,
    batch: number,
    offset: number,
    decoder: TextDecoder,
    visitor: LineVisitor,
  ): void {
    let lineStart = 0;
    for (const line of decoder.decode(slice).split('\n')) {
      const newline = slice.indexOf(NEWLINE, lineStart);
      const lineEnd = newline === -1 ? slice.byteLength : newline;
      if (line.length > 0) {
        const index = this.lineStart.length;
        this.lineBatch.push(batch);
        this.lineStart.push(offset + lineStart);
        this.lineEnd.push(offset + lineEnd);
        visitor.line(line, index);
      }
      lineStart = lineEnd + 1;
    }
  }

  /**
   * @throws {Error} once disposed, so a late call fails instead of answering
   *   from emptied indexes
   */
  private assertOpen(): void {
    if (this.disposed) throw new Error('LineStore disposed');
  }
}
