import { describe, expect, it } from 'bun:test';

import { ByteStringSearchIndex } from './ByteStringSearchIndex';
import { LineStore } from './LineStore';
import { encode } from './test-utils';

/** Ids found for `needle`, as a plain array. */
async function ids(index: ByteStringSearchIndex, needle: string) {
  return Array.from(await index.search(needle));
}

describe('ByteStringSearchIndex', () => {
  it('finds non-Latin values case-insensitively, by UTF-8 bytes', async () => {
    const index = new ByteStringSearchIndex();
    index.append(['Ivanov']);
    index.append(['Владимир Иванов']);
    index.append(['Петрова', 'ИВАНОВА']);
    index.append(['“Иванов” Ltd']);

    expect(await ids(index, 'ИВАНОВ')).toEqual([1, 2, 3]);
    expect(await ids(index, 'иванов')).toEqual([1, 2, 3]);
    expect(await ids(index, '“иванов”')).toEqual([3]);
    expect(await ids(index, 'ivanov')).toEqual([0]);
    expect(await ids(index, '²')).toEqual([]);
  });

  it('never matches across two values or two documents', async () => {
    const index = new ByteStringSearchIndex();
    index.append(['abc', 'def']);
    index.append(['foo']);
    index.append(['bar']);

    expect(await ids(index, 'abc')).toEqual([0]);
    expect(await ids(index, 'cd')).toEqual([]);
    expect(await ids(index, 'foobar')).toEqual([]);
  });

  it('reports a document once however many values match', async () => {
    const index = new ByteStringSearchIndex();
    index.append(['x a', 'a', 'aa']);
    index.append(['b']);
    index.append(['a']);
    expect(await ids(index, 'a')).toEqual([0, 2]);
  });

  it('matches every document for an empty needle', async () => {
    const index = new ByteStringSearchIndex();
    index.append(['a']);
    index.append([]);
    expect(await ids(index, '')).toEqual([0, 1]);
  });

  it('searches across sealed segments and pending documents', async () => {
    const index = new ByteStringSearchIndex();
    for (let i = 0; i < 3000; i++) {
      index.append([`tok${i}z`]);
      if (i % 1000 === 999) index.seal();
    }
    index.append(['tok3000z']);
    for (const i of [0, 999, 1000, 2999, 3000]) {
      expect(await ids(index, `tok${i}z`)).toEqual([i]);
    }
    expect(index.size).toBe(3001);
  });

  it('keeps earlier text when one document outgrows the scratch space', async () => {
    const index = new ByteStringSearchIndex();
    index.append(['first value']);
    index.append([`${'я'.repeat(1_200_000)}конец`]);
    index.append(['last value']);

    expect(await ids(index, 'first value')).toEqual([0]);
    expect(await ids(index, 'конец')).toEqual([1]);
    expect(await ids(index, 'last value')).toEqual([2]);
  });

  it('refuses use once disposed', async () => {
    const index = new ByteStringSearchIndex();
    index.dispose();
    expect(() => index.append(['a'])).toThrow('disposed');
    await expect(index.search('a')).rejects.toThrow('disposed');
  });
});

describe('LineStore', () => {
  it('numbers non-empty lines and reads them back', async () => {
    const store = new LineStore();
    const seen: [string, number][] = [];
    const visitor = { line: (text: string, i: number) => seen.push([text, i]) };
    await store.append(encode('{"a":1}\n\n{"b":"я"}\n'), visitor);
    await store.append(encode('{"c":3}'), visitor);

    expect(seen).toEqual([
      ['{"a":1}', 0],
      ['{"b":"я"}', 1],
      ['{"c":3}', 2],
    ]);
    expect(store.length).toBe(3);
    expect(await store.read(1)).toBe('{"b":"я"}');
    expect(await store.read(2)).toBe('{"c":3}');
    await expect(store.read(3)).rejects.toThrow(RangeError);
  });

  it('indexes a batch spanning many slices, keeping byte offsets right', async () => {
    // Cyrillic filler makes byte offsets differ from char offsets, so an
    // offset mix-up would read back the wrong bytes.
    const lines = Array.from({ length: 600 }, (_, i) => `{"i":${i},"v":"${'Иванов '.repeat(30)}"}`);
    const store = new LineStore({ sliceBytes: 4096 });
    let slices = 0;
    await store.append(encode(`${lines.join('\n')}\n`), {
      line: () => undefined,
      sliceEnd: () => slices++,
    });

    expect(slices).toBeGreaterThan(50);
    expect(store.length).toBe(600);
    for (const i of [0, 1, 123, 299, 300, 599]) {
      expect(await store.read(i)).toBe(lines[i] as string);
    }
  });

  it('passes on what the visitor throws', async () => {
    const store = new LineStore();
    await expect(
      store.append(encode('ok\nbad\n'), {
        line: (text) => {
          if (text === 'bad') throw new Error('not an entry');
        },
      }),
    ).rejects.toThrow('not an entry');
  });

  it('refuses use once disposed', async () => {
    const store = new LineStore();
    await store.append(encode('a\n'), { line: () => undefined });
    store.dispose();
    await expect(store.read(0)).rejects.toThrow('disposed');
  });
});
