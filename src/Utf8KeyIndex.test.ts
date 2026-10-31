import { describe, expect, it } from 'bun:test';

import { Utf8KeyIndex } from './Utf8KeyIndex';

describe('Utf8KeyIndex', () => {
  it('finds each key by the order it was added in', () => {
    const index = new Utf8KeyIndex();
    for (const key of ['a', 'ab', 'b', '']) index.add(key);
    expect(index.get('a')).toBe(0);
    expect(index.get('ab')).toBe(1);
    expect(index.get('b')).toBe(2);
    expect(index.get('')).toBe(3);
    expect(index.get('abc')).toBeUndefined();
    expect(index.size).toBe(4);
  });

  it('tells apart keys that differ only beyond ASCII', () => {
    const index = new Utf8KeyIndex();
    for (const key of ['café', 'cafe', '人名', '人', '😀']) index.add(key);
    expect(index.get('cafe')).toBe(1);
    expect(index.get('café')).toBe(0);
    expect(index.get('人名')).toBe(2);
    expect(index.get('人')).toBe(3);
    expect(index.get('😀')).toBe(4);
    expect(index.get('人名人')).toBeUndefined();
  });

  it('keeps every key as it grows and after trimming', () => {
    const index = new Utf8KeyIndex();
    for (let i = 0; i < 50_000; i++) index.add(`key-${i}`);
    index.trim();
    expect(index.get('key-0')).toBe(0);
    expect(index.get('key-31337')).toBe(31_337);
    expect(index.get('key-49999')).toBe(49_999);
    expect(index.get('key-50000')).toBeUndefined();
  });

  it('answers the last index of a key added twice, as a Map would', () => {
    const index = new Utf8KeyIndex();
    for (const key of ['x', 'y', 'x']) index.add(key);
    expect(index.get('x')).toBe(2);
    expect(index.get('y')).toBe(1);
  });

  it('refuses use once disposed', () => {
    const index = new Utf8KeyIndex();
    index.add('a');
    index.dispose();
    expect(() => index.add('b')).toThrow('disposed');
    expect(() => index.get('a')).toThrow('disposed');
    expect(() => index.trim()).toThrow('disposed');
  });
});
