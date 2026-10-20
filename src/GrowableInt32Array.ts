/**
 * Default cap on how many values one array can hold: 64M. A resizable
 * `ArrayBuffer` reserves address space (not memory) up to its maximum, so the
 * cap is generous but not unbounded.
 */
const DEFAULT_MAX_LENGTH = 1 << 26;

/**
 * An `Int32Array` that grows as values are pushed, doubling its capacity
 * (amortised O(1) push, like a vector). Per-line indexes over hundreds of
 * thousands of lines stay a few contiguous typed arrays instead of plain
 * arrays of boxed numbers, which keeps the JS heap small and reads fast.
 *
 * Backed by a resizable `ArrayBuffer` (ES2024), which grows in place: no copy
 * into a bigger array on each doubling, and the view tracks the buffer's
 * length.
 */
export class GrowableInt32Array {
  private readonly buffer: ArrayBuffer;
  /** Length-tracking: always spans the whole buffer, spare capacity included. */
  private readonly values: Int32Array;
  private size = 0;

  /** @param maxLength how many values it can ever hold */
  constructor(maxLength = DEFAULT_MAX_LENGTH) {
    this.buffer = new ArrayBuffer(Math.min(1024, maxLength) * 4, {
      maxByteLength: maxLength * 4,
    });
    this.values = new Int32Array(this.buffer);
  }

  get length(): number {
    return this.size;
  }

  /** @throws {RangeError} if the array already holds its maximum length */
  push(value: number): void {
    if (this.size === this.values.length) {
      this.buffer.resize(Math.min(this.buffer.byteLength * 2, this.buffer.maxByteLength));
    }
    if (this.size === this.values.length) {
      throw new RangeError(`More than ${this.size} values`);
    }
    this.values[this.size++] = value;
  }

  /**
   * The value at `index`.
   *
   * @throws {RangeError} if `index` is outside `[0, length)`
   */
  at(index: number): number {
    if (index < 0 || index >= this.size) {
      throw new RangeError(`Index ${index} outside [0, ${this.size})`);
    }
    return this.values[index] as number;
  }

  /**
   * A view of the pushed values. The buffer only ever grows, so the view
   * stays valid, but it does not show values pushed after it was taken.
   */
  toArray(): Int32Array {
    return this.values.subarray(0, this.size);
  }
}
