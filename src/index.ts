/**
 * Stream, batch and index huge NDJSON files in the browser without holding
 * them on the JS heap.
 *
 * @packageDocumentation
 */
export { NEWLINE, concat, toByteString } from './bytes';
export { NdjsonError, type NdjsonErrorCode } from './errors';
export { GrowableInt32Array } from './GrowableInt32Array';
export { yieldToMain } from './yield-to-main';
export { LineBatcher } from './LineBatcher';
export { BoundedLineBatcher } from './BoundedLineBatcher';
export { readFirstLine } from './read-first-line';
export { boundedBatches } from './bounded-batches';
export { LineStore, type LineVisitor } from './LineStore';
export { ByteStringSearchIndex } from './ByteStringSearchIndex';
