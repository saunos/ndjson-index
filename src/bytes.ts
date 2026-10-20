/** The byte that ends every NDJSON line. */
export const NEWLINE = 0x0a;

/**
 * Copies `chunks` end to end into one new buffer.
 *
 * @param byteLength the chunks' total length, which callers already track
 */
export function concat(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Bytes per `String.fromCharCode` call: well under engines' argument limits. */
const CHARS_PER_CALL = 32 * 1024;

/**
 * The "byte string" of `bytes`: one char per byte, with the byte's value as
 * its char code.
 *
 * Every char is at most 0xFF, so V8 stores the string at one byte per char,
 * where a string with any char outside Latin-1 costs two. It can still be
 * searched with the native `String.indexOf`, which is several times faster
 * than scanning a `Uint8Array` in JS. Encode a needle the same way and it
 * occurs exactly where its bytes do.
 *
 * Built in chunks because `fromCharCode` takes one argument per char; `join`
 * then yields one flat string, which `indexOf` scans without first copying it.
 */
export function toByteString(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let at = 0; at < bytes.length; at += CHARS_PER_CALL) {
    // `apply` passes the typed array as the argument list directly; a spread
    // would first iterate it into an array, which is several times slower.
    // `Reflect.apply` is typed to return `any`; `String()` makes it a string
    // without a cast (it already is one, so this costs nothing).
    // `fromCodePoint` would give the same chars here, since every value is a
    // byte (< 0x100), but it validates each argument as a code point and is
    // several times slower on a 500 MB file.
    parts.push(
      String(
        Reflect.apply(
          String.fromCharCode, // NOSONAR: bytes only, see above
          undefined,
          bytes.subarray(at, at + CHARS_PER_CALL),
        ),
      ),
    );
  }
  return parts.join('');
}
