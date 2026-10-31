# `Utf8KeyIndex` Design and Constants

[`Utf8KeyIndex`](../src/Utf8KeyIndex.ts) maps string keys to sequential index numbers (`0, 1, 2, …`). You add keys in arrival order. The index does not keep string objects on the JavaScript heap.

Interactive visualization: [`utf8-key-index.html`](./utf8-key-index.html)

---

## Memory Layout

A standard `Map<string, number>` keeps one string object and one map entry on the JavaScript heap for each key. Instead, `Utf8KeyIndex` stores all data in four typed arrays:

1. **`bytes: Uint8Array`** — Stores the UTF-8 bytes of all keys one after another. There are no separator bytes between keys.
2. **`ends: Int32Array`** — Stores the end byte offset of each key `i` in `bytes`. The bytes for key `i` are in `bytes.subarray(i === 0 ? 0 : ends[i - 1], ends[i])`.
3. **`hashes: Int32Array`** — Stores the 32-bit FNV-1a hash for each key `i`. When the table grows or checks a slot, it reads `hashes[i]`. It does not read or hash `bytes` again.
4. **`table: Int32Array`** — An open-addressing hash table. Its length is always a power of two. Each slot contains `FREE (-1)` or an index `i`.

---

## Insert Algorithm (`add(key)`)

When you call `add(key)`, `Utf8KeyIndex` does these steps:

1. **Assign the index number**:
   The new key gets the current `count` as its index (`0` for the first key, `1` for the second key, and so on).
2. **Check the table capacity**:
   If `count` equals `hashes.length` (the hash table is 50% full), `grow()` runs:
   - It creates a new `table` with twice as many slots and fills it with `FREE (-1)`.
   - For each existing index `i` from `0` to `count - 1`, it calculates `slot = hashes[i] & newMask`, moves forward to the first `FREE` slot, and writes `i`.
   - It doubles the length of `hashes` and `ends`.
3. **Write UTF-8 bytes and calculate the hash (`appendBytes(key)`)**:
   - First, it checks if `used + key.length * 3` is greater than `bytes.length` (UTF-8 uses at most 3 bytes per UTF-16 code unit). If so, it doubles `bytes`.
   - Next, it loops through each character code of `key`:
     - It updates the 32-bit FNV-1a hash: `hash = Math.imul(hash ^ code, FNV_PRIME)`.
     - If `code < 128` (ASCII), it writes `code` directly into `bytes[used + i]`.
     - If `code >= 128` (non-ASCII), it sets `ascii = false`.
   - If `ascii` is `true`, it adds `key.length` to `used`. If `ascii` is `false`, `TextEncoder.encodeInto()` writes the full UTF-8 bytes of `key` at `bytes[used]` and adds the written byte count to `used`.
4. **Save index metadata**:
   It writes the new `used` offset into `ends[index]`, writes `hash` into `hashes[index]`, and adds `1` to `count`.
5. **Store the index in the hash table**:
   It calls `slotOf(key, hash)` to find the target slot and writes `table[slot] = index`. If `key` was already in the table, this step overwrites the slot with the new `index`.

---

## Lookup Algorithm (`get(key)`)

When you call `get(key)`, `Utf8KeyIndex` does these steps:

1. **Calculate the hash**:
   `hashOf(key)` loops through the character codes of `key` and calculates the 32-bit FNV-1a hash.
2. **Start at the home slot (`slotOf(key, hash)`)**:
   It calculates `mask = table.length - 1` and starts at `slot = hash & mask`.
3. **Probe slots one by one**:
   It reads `ord = table[slot]`:
   - **Case A — Empty slot (`ord === FREE`)**:
     The key is not in the index. `slotOf` returns this free `slot`, and `get(key)` returns `undefined`.
   - **Case B — Hash mismatch (`hashes[ord] !== hash`)**:
     The slot holds a different key. It skips byte comparison and moves to the next slot: `slot = (slot + 1) & mask`.
   - **Case C — Hash match (`hashes[ord] === hash`)**:
     It calls `keyEquals(ord, key)` to compare the stored bytes at `[start, end)` with `key`:
     - For an ASCII `key`, it checks that `end - start === key.length` and compares each byte `bytes[start + i]` with `key.charCodeAt(i)`. This check does not allocate memory.
     - For a non-ASCII `key`, it encodes `key` to UTF-8 and compares the byte arrays.
     - If the bytes match, `get(key)` returns `ord`.
     - If the bytes do not match (a hash collision), it moves to the next slot: `slot = (slot + 1) & mask`.

---

## Reasons for Each Constant

### 1. `const SLOTS_PER_KEY = 2;` (Maximum load factor = 50%)

The hash table uses **linear probing** (`slot = (slot + 1) & mask`). When the load factor `α` (`keys / slots`) is greater than `0.5`, keys group together and searches become slow.

- **Average probes for a found key**: `0.5 × (1 + 1 / (1 - α))`
- **Average probes for a missing key or insert**: `0.5 × (1 + 1 / (1 - α)²)`

When **`α = 0.5`** (`SLOTS_PER_KEY = 2`):
- A search for an existing key checks **1.5 slots** on average.
- A search for a missing key or an insert checks **2.5 slots** on average.
- At least half of the slots are always `FREE (-1)`. Because of this, the loop in `slotOf()` always finds a free slot and stops. Also, `table.length / SLOTS_PER_KEY` is always a power of two.

---

### 2. `const INITIAL_SLOTS = 1 << 10;` (1,024 slots)

- **Power of two**: Because `table.length` is a power of two (`2¹⁰ = 1024`), the index finds a slot with a bitwise AND operation instead of a modulo (`%`) operation:
  ```ts
  slot = hash & (table.length - 1);
  ```
- **Initial size of 1,024**: With `SLOTS_PER_KEY = 2`, 1,024 slots hold up to **512 keys** before `grow()` runs. The initial memory size is **8 KB**:
  - `table`: `1024 × 4 B = 4 KB`
  - `hashes` + `ends`: `512 × 4 B × 2 = 4 KB`
  This size prevents 6 to 8 small resize operations on the first 512 keys and uses very little memory when empty.

---

### 3. `const FNV_OFFSET = 0x811c9dc5;` and `const FNV_PRIME = 0x01000193;`

These values are the standard **32-bit FNV-1a (Fowler–Noll–Vo)** hash constants:

- **`0x811c9dc5` (`2,166,136,261`)**: The 32-bit FNV offset basis. A non-zero start value prevents zero-byte inputs from producing a `0` hash (because `0 × prime = 0`).
- **`0x01000193` (`16,777,619` = `2²⁴ + 2⁸ + 0x93`)**: The 32-bit FNV prime. With XOR (`^`), this prime spreads hash bits evenly across 32-bit integers.
- **Why we use FNV-1a in JavaScript**: `Math.imul(hash ^ code, FNV_PRIME)` runs as one 32-bit integer multiplication instruction. It does not allocate memory or use lookup tables. `appendBytes()` calculates this hash in the same loop that copies ASCII characters.

---

### 4. `private bytes = new Uint8Array(1 << 16);` (64 KB)

- `2¹⁶ = 65,536 bytes` (64 KB).
- This size matches `INITIAL_SLOTS`. For example, 512 UUID keys of 36 bytes use `18 KB` (and 512 keys of 128 bytes use `64 KB`). Thus, the first 512 to 1,500 keys fit in `bytes` without a buffer resize.
- After you add all keys, call `trim()`. This method cuts `bytes` to `this.used` and releases unused memory.

---

## How `Uint8Array` Stores Data Outside the V8 Heap

`Uint8Array` still stores data in process RAM, but not in the **V8 garbage-collected object heap** (for buffers larger than 64 bytes).

A `Uint8Array` has two parts:

1. **The JavaScript wrapper object (~64 bytes)**: Lives on the **V8 JavaScript heap**. It stores the byte length, the byte offset, and a memory pointer to the backing buffer.
2. **The backing buffer (`ArrayBuffer` bytes)**: Lives in **native C++ / OS process memory** (allocated with PartitionAlloc, `malloc`, or `mmap`).

This separation gives three benefits:

- **One garbage collection (GC) object instead of millions**: The V8 garbage collector sees only **one** `Uint8Array` wrapper object. During a GC cycle, V8 checks if that wrapper is reachable and never scans the megabytes of raw bytes inside the buffer.
- **No per-key object header**: On the V8 heap, each JavaScript string or object has a 12-to-24-byte V8 header and alignment padding. In `Uint8Array`, keys sit next to each other as raw bytes with zero headers.
- **CPU cache locality**: Because the bytes sit in one continuous block of memory, the CPU reads adjacent bytes in a single 64-byte cache line instead of following pointers across the heap.

---

## Comparison with `Map<string, number>` (1,000,000 Keys)

The table below compares `Map<string, number>` and `Utf8KeyIndex` for **1,000,000 ASCII keys** with an average length of **16 bytes**:

| Feature | `Map<string, number>` (V8 `OrderedHashMap`) | `Utf8KeyIndex` (TypedArray Arena) |
| :--- | :--- | :--- |
| **Key storage** | **1,000,000 `String` objects** on the V8 heap. Each 16-byte string uses a 12-to-16-byte header plus 8-byte alignment (**~32 MB**). | **1 continuous `Uint8Array`** in native memory. 16 bytes per key, no headers, and no padding (**16 MB**). |
| **Table structure** | V8 `OrderedHashMap` keeps insertion order. Each entry uses 3 tagged slots (`key`, `value`, `next`) plus a bucket array (**~32–48 MB**). | Flat `Int32Array` arrays for `ends` (4 MB), `hashes` (4 MB), and `table` (8–16 MB) (**~16–24 MB**). |
| **GC objects** | **1,000,001+ heap objects** (1 `Map` + 1,000,000 `String` objects). | **5 heap objects in total** (1 class instance + 4 TypedArray wrappers), for any number of keys. |
| **Total RAM (1M keys)** | **~65–80 MB** | **~32–40 MB** |

### Garbage Collection Impact

- **`Map<string, number>`**: During a Major GC cycle, V8 walks the `Map` table, visits all 1,000,000 `String` pointers, marks them as live, and moves them during memory compaction. With millions of keys, GC pause times increase and can reach V8's ~4 GB heap limit.
- **`Utf8KeyIndex`**: The GC checks only the 4 TypedArray wrapper objects. It skips the backing byte buffers completely because TypedArrays cannot hold JavaScript object pointers.

### Lookup and Insert Speed

- **When `Map<string, number>` is faster**:
  If the caller already has a JavaScript `string`, V8 saves the string hash inside the V8 string header on the first lookup. Later `map.get(str)` calls read the saved hash in C++ without reading the characters again.
- **When `Utf8KeyIndex` is faster**:
  - **Raw byte streams (NDJSON / Buffers)**: With `Map<string, number>`, you must decode each input slice into a new JavaScript `string` on the heap before you call `map.get()`. With a byte-backed index, you can hash and compare raw `Uint8Array` slices directly with zero heap allocations.
  - **Serialization and worker threads**: You cannot share a `Map<string, number>` across Worker threads (`SharedArrayBuffer`), and you must serialize keys one by one to save it to disk. With `Utf8KeyIndex`, you can write the typed arrays directly to disk or transfer their `ArrayBuffer` across threads with zero copy.

### Summary: When to Use Each

- Use **`Map<string, number>`** when you have fewer than 500,000 keys, your keys already exist as JavaScript `string` objects, and you do not need to save or share the index across threads.
- Use **`Utf8KeyIndex`** when you have millions of keys, want zero GC pause overhead, index raw UTF-8 streams, or want to save or share the index as flat binary buffers.

