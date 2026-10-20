/**
 * Why a stream could not be read as NDJSON:
 *
 * - `no-newline`: the stream ended before the line being read did
 * - `line-too-long`: a line grew past the caller's cap
 * - `not-on-line-boundary`: a declared byte length does not end on a newline
 * - `truncated`: the stream ended before a declared byte length was reached
 */
export type NdjsonErrorCode = 'no-newline' | 'line-too-long' | 'not-on-line-boundary' | 'truncated';

/** The stream's bytes do not have the shape the reader was told to expect. */
export class NdjsonError extends Error {
  constructor(
    readonly code: NdjsonErrorCode,
    message: string,
    /**
     * For `not-on-line-boundary` and `truncated`: the byte of the part where
     * the problem shows, so a caller can report it in its own terms. The
     * declared length for the first, the bytes received for the second.
     */
    readonly offset?: number,
  ) {
    super(message);
    this.name = 'NdjsonError';
  }
}
