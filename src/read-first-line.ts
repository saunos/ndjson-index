import { NEWLINE, concat } from './bytes';
import { NdjsonError } from './errors';

interface ReadFirstLineOptions {
  /**
   * The longest line this reader buffers. A header line is usually a few
   * kilobytes; a stream with no newline in its first `maxBytes` is not what
   * the caller expects, and buffering it whole would put the entire download
   * in the JS heap before failing.
   */
  maxBytes: number;
}

/**
 * Reads up to the first newline and decodes that line, typically a header
 * that describes the rest of the stream.
 *
 * Chunks are held until the newline arrives, so a line split across network
 * reads is put back together. Only this line is ever decoded to a JS string;
 * the rest of the stream stays bytes, and is left unread.
 *
 * @returns the line without its newline, and the bytes read past it (a view
 *   into the last chunk; null when the newline was its last byte)
 * @throws {NdjsonError} `no-newline` if the stream ends before any newline,
 *   or `line-too-long` if the line grows past `maxBytes`. The reader is not
 *   cancelled; that is the caller's call.
 */
export async function readFirstLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  { maxBytes }: ReadFirstLineOptions,
): Promise<{ line: string; rest: Uint8Array | null }> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      throw new NdjsonError('no-newline', 'stream ended before line 1 did');
    }
    const at = value.indexOf(NEWLINE);
    // Checked before keeping the chunk, so at most one chunk past the cap
    // is ever held.
    if (length + (at === -1 ? value.byteLength : at) > maxBytes) {
      throw new NdjsonError('line-too-long', `line 1 is over ${maxBytes} bytes`);
    }
    if (at === -1) {
      chunks.push(value);
      length += value.byteLength;
      continue;
    }
    chunks.push(value.subarray(0, at));
    length += at;
    const rest = value.subarray(at + 1);
    return {
      line: new TextDecoder().decode(concat(chunks, length)),
      rest: rest.byteLength > 0 ? rest : null,
    };
  }
}
