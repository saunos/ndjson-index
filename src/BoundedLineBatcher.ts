import { NEWLINE } from './bytes';
import { NdjsonError } from './errors';
import { LineBatcher } from './LineBatcher';

/**
 * Cuts exactly the first `byteLength` bytes of a stream into line-aligned
 * batches, for a file whose header declares how long its next part is.
 *
 * Feeds those bytes into a {@link LineBatcher} and reports when the part is
 * complete, so the reader can stop downloading instead of fetching what
 * follows. A chunk that straddles the boundary is cut there, and the batcher
 * is flushed, so the last batch ends exactly at the part's last newline and
 * never carries a line of the next part.
 */
export class BoundedLineBatcher {
  private readonly batcher: LineBatcher;
  private seen = 0;

  /**
   * @param byteLength the part's length; it must end on a newline
   * @param batchBytes batch size goal, see {@link LineBatcher}
   */
  constructor(
    private readonly byteLength: number,
    batchBytes: number,
  ) {
    this.batcher = new LineBatcher(batchBytes);
  }

  /** Whether every byte of the part has been consumed and flushed. */
  get complete(): boolean {
    return this.seen === this.byteLength;
  }

  /**
   * Consumes the next chunk.
   *
   * @returns the batches it completed, in order: none, one, or two when the
   *   chunk crosses the part's end (a cut, then the final flush)
   * @throws {NdjsonError} `not-on-line-boundary` if the byte before the part's
   *   end is not a newline: then the declared length does not match the
   *   file, and every line after it would be misattributed
   */
  push(chunk: Uint8Array): Uint8Array<ArrayBuffer>[] {
    if (this.complete) return [];
    const left = this.byteLength - this.seen;
    if (chunk.byteLength < left) {
      this.seen += chunk.byteLength;
      return present(this.batcher.push(chunk));
    }
    const head = chunk.subarray(0, left);
    this.seen = this.byteLength;
    if (head[head.byteLength - 1] !== NEWLINE) {
      throw new NdjsonError(
        'not-on-line-boundary',
        `byte ${this.byteLength} of the part is not a newline: ` +
          'the declared length does not fall on a line boundary',
        this.byteLength,
      );
    }
    return [...present(this.batcher.push(head)), ...present(this.batcher.end())];
  }

  /**
   * Called when the stream ends.
   *
   * @throws {NdjsonError} `truncated` if it ended inside the part
   */
  end(): void {
    if (!this.complete) {
      throw new NdjsonError(
        'truncated',
        `stream ended after ${this.seen} bytes of the part, ` + `which declares ${this.byteLength}`,
        this.seen,
      );
    }
  }
}

/** Wraps an optional batch as a list, so callers can spread it. */
function present(batch: Uint8Array<ArrayBuffer> | null): Uint8Array<ArrayBuffer>[] {
  return batch == null ? [] : [batch];
}
