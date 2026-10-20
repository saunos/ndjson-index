import { toByteString } from './bytes';
import { GrowableInt32Array } from './GrowableInt32Array';
import { yieldToMain } from './yield-to-main';

/** A search that has run this long gives the event loop a turn before going on. */
const SCAN_BUDGET_MS = 30;

/**
 * Separates one value from the next in a document's text, and one document
 * from the next in a segment (as the byte 0x00), so a match never spans two
 * values. Nobody types a NUL into a search box.
 */
const SEPARATOR = '\0';

/**
 * The text of a run of consecutive documents: every document's lowercased
 * values laid end to end, so a search is one `indexOf` per segment instead of
 * one call per document.
 */
interface Segment {
  /** Id of the segment's first document. */
  firstDoc: number;
  /** A byte string, see {@link toByteString}. */
  text: string;
  /** Where each document's text starts in `text`; ascending. */
  starts: Int32Array;
}

/**
 * A case-insensitive substring index over many small documents (such as the
 * values of each NDJSON line), held compactly on the JS heap.
 *
 * Documents are kept as "byte strings": their UTF-8 bytes, one char per byte.
 * A plain JS string costs two bytes per char as soon as one char is outside
 * Latin-1 (a name in Cyrillic, a curly quote), and most real text has one; a
 * byte string stays at one byte per char and can still be searched with the
 * native `String.indexOf`. A needle's UTF-8 bytes occur exactly where the
 * needle does, so the answers are the same.
 *
 * Documents are grouped into segments, each one flat string. Call
 * {@link seal} every MB or so of input (for example from
 * `LineVisitor.sliceEnd`), so no single string gets huge and a search can
 * yield between segments.
 */
export class ByteStringSearchIndex {
  private segments: Segment[] = [];
  private docs = 0;
  /** Id of the first document not yet in a segment. */
  private pendingFirst = 0;
  /**
   * Reused space the pending documents are encoded into before a trimmed copy
   * becomes their segment, so appending does not allocate per document.
   */
  private scratch = new Uint8Array(1 << 21);
  private written = 0;
  /** Where each pending document starts in {@link scratch}. */
  private pendingStarts = new Int32Array(1024);
  private readonly encoder = new TextEncoder();
  private disposed = false;

  /** How many documents were appended. */
  get size(): number {
    return this.docs;
  }

  /**
   * Adds one document; ids count up from zero.
   *
   * @param values matched separately: a needle never matches across two of
   *   them. Lowercased here, as {@link search} lowercases the needle.
   * @returns the document's id
   */
  append(values: readonly string[]): number {
    this.assertOpen();
    const pending = this.docs - this.pendingFirst;
    if (pending === this.pendingStarts.length) {
      const grown = new Int32Array(pending * 2);
      grown.set(this.pendingStarts);
      this.pendingStarts = grown;
    }
    this.pendingStarts[pending] = this.written;
    this.encode(values.map((value) => value.toLowerCase()).join(SEPARATOR));
    return this.docs++;
  }

  /**
   * Closes the pending documents into a segment. Cheap when nothing is
   * pending, and called by {@link search} itself, so it only decides where
   * segments end.
   */
  seal(): void {
    const pending = this.docs - this.pendingFirst;
    if (pending === 0) return;
    this.segments.push({
      firstDoc: this.pendingFirst,
      text: toByteString(this.scratch.subarray(0, this.written)),
      // A trimmed copy, so the unused tail is not kept.
      starts: this.pendingStarts.slice(0, pending),
    });
    this.pendingFirst = this.docs;
    this.written = 0;
  }

  /**
   * The ids of documents any of whose values contain `needle`, ignoring case,
   * ascending. An empty needle matches every document.
   *
   * Each segment is scanned for the needle's bytes. A hit is mapped to its
   * document by binary search over the segment's starts, and the scan resumes
   * at the next document, so a document is reported once however many of its
   * values match. Yields to the event loop every {@link SCAN_BUDGET_MS}.
   */
  async search(needle: string): Promise<Int32Array> {
    this.assertOpen();
    this.seal();
    const bytes = toByteString(new TextEncoder().encode(needle.toLowerCase()));
    const found = new GrowableInt32Array();
    let sliceStarted = performance.now();
    for (const { firstDoc, text, starts } of this.segments) {
      let at = text.indexOf(bytes);
      while (at !== -1) {
        const doc = lastAtOrBefore(starts, at);
        found.push(firstDoc + doc);
        const next = starts[doc + 1];
        if (next == null) break;
        at = text.indexOf(bytes, next);
      }
      if (performance.now() - sliceStarted > SCAN_BUDGET_MS) {
        await yieldToMain();
        sliceStarted = performance.now();
      }
    }
    return found.toArray();
  }

  /**
   * Drops every segment, so their text can be collected. Safe to call more
   * than once; a later {@link append} or {@link search} throws.
   */
  dispose(): void {
    this.disposed = true;
    this.segments = [];
    this.scratch = new Uint8Array(0);
    this.pendingStarts = new Int32Array(0);
    this.docs = 0;
    this.pendingFirst = 0;
    this.written = 0;
  }

  /**
   * Writes `text` as UTF-8 into {@link scratch}, then a separator byte,
   * growing the scratch space first if `text` might not fit.
   */
  private encode(text: string): void {
    // UTF-8 needs at most 3 bytes per UTF-16 code unit, plus the separator.
    const needed = this.written + text.length * 3 + 1;
    if (needed > this.scratch.length) {
      const grown = new Uint8Array(Math.max(needed, this.scratch.length * 2));
      grown.set(this.scratch.subarray(0, this.written));
      this.scratch = grown;
    }
    const { written } = this.encoder.encodeInto(text, this.scratch.subarray(this.written));
    this.scratch[this.written + written] = 0;
    this.written += written + 1;
  }

  /** @throws {Error} once disposed */
  private assertOpen(): void {
    if (this.disposed) throw new Error('ByteStringSearchIndex disposed');
  }
}

/** Index of the last element of ascending `sorted` that is ≤ `value`. */
function lastAtOrBefore(sorted: Int32Array, value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((sorted[mid] ?? 0) <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}
