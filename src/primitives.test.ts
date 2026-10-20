import { describe, expect, it } from 'bun:test';

import { NEWLINE, concat, toByteString } from './bytes';
import { GrowableInt32Array } from './GrowableInt32Array';
import { LineBatcher } from './LineBatcher';
import { encode, join } from './test-utils';
import { yieldToMain } from './yield-to-main';

describe('concat', () => {
  it('copies chunks end to end', () => {
    expect(concat([encode('ab'), encode(''), encode('cde')], 5)).toEqual(encode('abcde'));
  });
});

describe('toByteString', () => {
  it('maps each byte to the char with that code', () => {
    const bytes = encode('aя“');
    const text = toByteString(bytes);
    expect(text.length).toBe(bytes.length);
    expect(Array.from(text, (c) => c.charCodeAt(0))).toEqual(Array.from(bytes));
  });

  it('handles inputs longer than one fromCharCode call', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    const text = toByteString(bytes);
    expect(text.length).toBe(100_000);
    expect(text.charCodeAt(70_000)).toBe(70_000 % 256);
  });
});

describe('GrowableInt32Array', () => {
  it('grows past its initial capacity and reads values back', () => {
    const array = new GrowableInt32Array();
    for (let i = 0; i < 5000; i++) array.push(i * 3);
    expect(array.length).toBe(5000);
    expect(array.at(4999)).toBe(4999 * 3);
    expect(array.toArray().length).toBe(5000);
  });

  it('refuses to grow past its maximum length', () => {
    const array = new GrowableInt32Array(2);
    array.push(1);
    array.push(2);
    expect(() => array.push(3)).toThrow(RangeError);
  });

  it('refuses indexes outside its length', () => {
    const array = new GrowableInt32Array();
    array.push(7);
    expect(() => array.at(1)).toThrow(RangeError);
    expect(() => array.at(-1)).toThrow(RangeError);
  });
});

describe('LineBatcher', () => {
  it('cuts at the last newline once the target is reached', () => {
    const batcher = new LineBatcher(8);
    expect(batcher.push(encode('ab\n'))).toBeNull();
    expect(batcher.push(encode('cd\nef'))).toEqual(encode('ab\ncd\n'));
    expect(batcher.end()).toEqual(encode('ef'));
    expect(batcher.end()).toBeNull();
  });

  it('holds a line longer than the target until its newline', () => {
    const batcher = new LineBatcher(2);
    expect(batcher.push(encode('abcd'))).toBeNull();
    expect(batcher.push(encode('ef'))).toBeNull();
    const batch = batcher.push(encode('\ng'));
    expect(batch).toEqual(encode('abcdef\n'));
    expect(batch?.at(-1)).toBe(NEWLINE);
  });

  it('yields batches that own their buffers', () => {
    const batcher = new LineBatcher(1);
    const chunk = encode('a\nb');
    const batch = batcher.push(chunk);
    chunk.fill(0);
    expect(batch).toEqual(encode('a\n'));
    expect(join([batch ?? new Uint8Array(), batcher.end() ?? new Uint8Array()])).toEqual(
      encode('a\nb'),
    );
  });
});

describe('yieldToMain', () => {
  it('resumes in a later task when scheduler.yield is missing', async () => {
    const order: string[] = [];
    const yielded = yieldToMain().then(() => order.push('yielded'));
    await Promise.resolve();
    order.push('same task');
    await yielded;
    expect(order).toEqual(['same task', 'yielded']);
  });
});
