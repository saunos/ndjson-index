/** Test helpers; not exported from the package. */

export const encode = (text: string) => new TextEncoder().encode(text);

/** What a test has seen of its stream. */
export interface StreamLog {
  /** Chunks the reader has asked for (pull calls). */
  pulls: number;
  cancelled: boolean;
}

/**
 * A stream that hands out `chunkSize`-byte chunks only when read (a pull
 * source with no read-ahead), and records pulls and cancellation.
 */
export function chunkedStream(
  data: Uint8Array,
  chunkSize = 256,
): { stream: ReadableStream<Uint8Array>; log: StreamLog } {
  const log: StreamLog = { pulls: 0, cancelled: false };
  let at = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        log.pulls++;
        if (at >= data.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(data.slice(at, at + chunkSize));
        at += chunkSize;
      },
      cancel() {
        log.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, log };
}

/** Copies `batches` end to end. */
export function join(batches: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(batches.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const batch of batches) {
    out.set(batch, at);
    at += batch.byteLength;
  }
  return out;
}

/** Reads every value of an async iterable. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of iterable) out.push(value);
  return out;
}
