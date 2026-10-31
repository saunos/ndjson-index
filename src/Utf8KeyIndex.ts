/** Marks a free slot of the hash table; indices are never negative. */
const FREE = -1;

/**
 * Slots per key the table keeps at least: at most half full, so linear probe
 * runs stay short.
 */
const SLOTS_PER_KEY = 2;

const INITIAL_SLOTS = 1 << 10;

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const encoder = new TextEncoder();

/**
 * Maps string keys added in arrival order to their sequential index
 * (`0, 1, 2, …`), without holding key strings on the JS heap.
 *
 * A `Map<string, number>` over hundreds of thousands of keys retains every key
 * as a boxed JS string object plus hash-table overhead on the V8 heap. Here
 * the keys are encoded once as UTF-8 bytes laid end to end in a single
 * `Uint8Array`, and lookup is an open-addressing hash table with linear
 * probing over an `Int32Array` of indices. Each key's hash is kept alongside
 * its end offset, so growing the table never re-hashes or re-reads a key.
 */
export class Utf8KeyIndex {
  /** Every key's UTF-8 bytes, in arrival order, with nothing between them. */
  private bytes = new Uint8Array(1 << 16);
  /** How much of {@link bytes} is used. */
  private used = 0;
  /**
   * Per index: where its key ends in {@link bytes}; the one before's end is
   * its start.
   */
  private ends = new Int32Array(INITIAL_SLOTS / SLOTS_PER_KEY);
  /** Per index: its key's hash, so the table can grow without hashing again. */
  private hashes = new Int32Array(INITIAL_SLOTS / SLOTS_PER_KEY);
  /** Hash slots, each {@link FREE} or an index; a power of two long. */
  private table = new Int32Array(INITIAL_SLOTS).fill(FREE);
  /** How many keys were added. */
  private count = 0;
  private disposed = false;

  /** How many keys were added. */
  get size(): number {
    return this.count;
  }

  /**
   * Adds the next key, assigning it the next index (`size` before the call).
   * A key added again answers its latest index from then on.
   *
   * @throws {Error} once disposed
   */
  add(key: string): void {
    this.assertOpen();
    const index = this.count;
    if (index === this.hashes.length) this.grow();
    const hash = this.appendBytes(key);
    this.ends[index] = this.used;
    this.hashes[index] = hash;
    this.count++;
    this.table[this.slotOf(key, hash)] = index;
  }

  /**
   * The latest index added with `key`, or `undefined` if `key` was never added.
   *
   * @throws {Error} once disposed
   */
  get(key: string): number | undefined {
    this.assertOpen();
    const index = this.table[this.slotOf(key, hashOf(key))] ?? FREE;
    return index === FREE ? undefined : index;
  }

  /**
   * Gives back the key buffer's spare room, which doubling left at up to half
   * of it. Call once the last key is in; adding more afterwards still works.
   *
   * @throws {Error} once disposed
   */
  trim(): void {
    this.assertOpen();
    this.bytes = this.bytes.slice(0, this.used);
  }

  /**
   * Drops every buffer, so the keys and table can be collected. Safe to call
   * more than once; a later {@link add}, {@link get} or {@link trim} throws.
   */
  dispose(): void {
    this.disposed = true;
    this.bytes = new Uint8Array(0);
    this.ends = new Int32Array(0);
    this.hashes = new Int32Array(0);
    this.table = new Int32Array(0);
    this.used = 0;
    this.count = 0;
  }

  /**
   * The slot holding `key`, or the free slot where it would go: linear
   * probing from its hash until either turns up.
   */
  private slotOf(key: string, hash: number): number {
    const mask = this.table.length - 1;
    for (let slot = hash & mask; ; slot = (slot + 1) & mask) {
      const index = this.table[slot] ?? FREE;
      if (index === FREE) return slot;
      if (this.hashes[index] === hash && this.keyEquals(index, key)) return slot;
    }
  }

  /**
   * Doubles the table and the per-index arrays, and puts every index
   * back by its kept hash.
   */
  private grow(): void {
    const table = new Int32Array(this.table.length * 2).fill(FREE);
    const mask = table.length - 1;
    for (let index = 0; index < this.count; index++) {
      let slot = (this.hashes[index] as number) & mask;
      while (table[slot] !== FREE) slot = (slot + 1) & mask;
      table[slot] = index;
    }
    this.table = table;
    this.hashes = grown(this.hashes, table.length / SLOTS_PER_KEY);
    this.ends = grown(this.ends, table.length / SLOTS_PER_KEY);
  }

  /**
   * Appends a key's UTF-8 bytes, growing the buffer when it may not fit.
   *
   * @returns the key's hash (see {@link hashOf}), computed in the same pass so
   *   the key is walked only once. ASCII, the usual case, is copied code unit
   *   by code unit as it goes; anything else is encoded afterwards.
   */
  private appendBytes(key: string): number {
    // UTF-8 takes at most three bytes per UTF-16 code unit.
    const needed = this.used + key.length * 3;
    if (needed > this.bytes.length) {
      const bytes = new Uint8Array(Math.max(needed, this.bytes.length * 2));
      bytes.set(this.bytes.subarray(0, this.used));
      this.bytes = bytes;
    }
    const { bytes, used } = this;
    let hash = FNV_OFFSET;
    let ascii = true;
    for (let i = 0; i < key.length; i++) {
      const code = key.charCodeAt(i);
      hash = Math.imul(hash ^ code, FNV_PRIME);
      if (code < 0x80) bytes[used + i] = code;
      else ascii = false;
    }
    this.used += ascii ? key.length : encoder.encodeInto(key, bytes.subarray(used)).written;
    return hash | 0;
  }

  /**
   * Whether an index's key is `key`. ASCII, the usual case, is compared
   * byte by code unit with no allocation; anything else is encoded first.
   */
  private keyEquals(index: number, key: string): boolean {
    const start = index === 0 ? 0 : (this.ends[index - 1] as number);
    const end = this.ends[index] as number;
    let ascii = true;
    for (let i = 0; i < key.length; i++) {
      if (key.charCodeAt(i) >= 0x80) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      if (end - start !== key.length) return false;
      for (let i = 0; i < key.length; i++) {
        if (this.bytes[start + i] !== key.charCodeAt(i)) return false;
      }
      return true;
    }
    const encoded = encoder.encode(key);
    if (end - start !== encoded.length) return false;
    return encoded.every((byte, i) => this.bytes[start + i] === byte);
  }

  /** @throws {Error} once disposed */
  private assertOpen(): void {
    if (this.disposed) throw new Error('Utf8KeyIndex disposed');
  }
}

/** A copy of `values` with room for `length` values. */
function grown(values: Int32Array<ArrayBuffer>, length: number): Int32Array<ArrayBuffer> {
  const copy = new Int32Array(length);
  copy.set(values);
  return copy;
}

/** FNV-1a over a key's UTF-16 code units, as a signed 32-bit integer. */
function hashOf(key: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), FNV_PRIME);
  }
  // Signed, as the Int32Array of hashes holds it, so kept and fresh hashes compare equal.
  return hash | 0;
}
