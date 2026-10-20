import { NEWLINE, concat } from './bytes';

/**
 * Accumulates stream chunks and cuts them into batches that end on a line
 * boundary.
 *
 * NDJSON makes line boundaries trivial: any JSON writer escapes a newline
 * inside a value as `\n`, so the byte 0x0A only ever ends a line. Cutting a
 * batch is "find the last newline once enough bytes are pending".
 *
 * `target` is a size goal, not a limit: a single line longer than the target
 * is held until its newline arrives. A batch that ended mid-line would make a
 * consumer's JSON parse fail on a truncated object, so the boundary is the
 * one thing that cannot be approximate.
 *
 * Every batch is a fresh copy that owns its `ArrayBuffer` (hence the
 * `Uint8Array<ArrayBuffer>` type, which `Blob` requires), so a consumer can
 * keep it without also keeping a network chunk alive, and the carried-over
 * tail never aliases it.
 */
export class LineBatcher {
  private chunks: Uint8Array[] = [];
  private pending = 0;

  /** @param target batch size goal in bytes */
  constructor(private readonly target: number) {}

  /**
   * Buffers `chunk` and, once at least `target` bytes are pending, cuts
   * everything up to the last newline.
   *
   * Keeps `chunk` by reference until the next cut, so the caller must not
   * mutate it afterwards.
   *
   * @returns the batch that was cut, or null when fewer than `target` bytes
   *   are pending or they hold no newline yet
   */
  push(chunk: Uint8Array): Uint8Array<ArrayBuffer> | null {
    this.chunks.push(chunk);
    this.pending += chunk.byteLength;
    return this.pending >= this.target ? this.cut() : null;
  }

  /**
   * Flushes whatever is pending, including a last line without a newline.
   *
   * @returns the final batch, or null when nothing is pending
   */
  end(): Uint8Array<ArrayBuffer> | null {
    if (this.pending === 0) return null;
    const rest = this.join().slice();
    this.chunks = [];
    this.pending = 0;
    return rest;
  }

  /** Cuts at the last pending newline and carries the rest over. */
  private cut(): Uint8Array<ArrayBuffer> | null {
    const buf = this.join();
    const at = buf.lastIndexOf(NEWLINE);
    if (at === -1) {
      // One line longer than the target: keep it whole until its newline.
      this.chunks = [buf];
      return null;
    }
    const tail = buf.subarray(at + 1);
    this.chunks = tail.byteLength > 0 ? [tail.slice()] : [];
    this.pending = tail.byteLength;
    return buf.subarray(0, at + 1).slice();
  }

  /** Coalesces the pending chunks into one buffer (no copy for one chunk). */
  private join(): Uint8Array {
    const [only] = this.chunks;
    if (this.chunks.length === 1 && only != null) return only;
    return concat(this.chunks, this.pending);
  }
}
