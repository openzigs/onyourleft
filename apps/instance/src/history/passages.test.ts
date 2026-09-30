// SPDX-License-Identifier: AGPL-3.0-or-later

/** What a synced item is cut into (#835, ADR 0040 D-2, D-8). */

import { describe, expect, it } from 'vitest';

import {
  cutSource,
  holdsDataUrl,
  INDEXED_KINDS,
  MAXIMUM_PASSAGE_CHARACTERS,
  MAXIMUM_PASSAGES_PER_SOURCE,
  MAXIMUM_SOURCE_CHARACTERS,
  splitBlock,
} from './passages.ts';

const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

describe('which items are cut, and from what', () => {
  it('indexes the four contents the owner named and nothing else (ADR 0040 D-2)', () => {
    expect([...INDEXED_KINDS].sort()).toStrictEqual(
      ['document', 'goal', 'note', 'ride-summary', 'write-up'].sort(),
    );
  });

  it('never cuts a side-camera report, whose pose summary the index may not hold', () => {
    const report = bytes({ text: 'Possibly more upright late on.', pose: { torso: 2 } });
    expect(cutSource('side-camera-report', report)).toEqual({ kind: 'empty' });
    expect(cutSource('activity', report)).toEqual({ kind: 'empty' });
  });

  it('takes a write-up’s text and nothing else of the record', () => {
    const cut = cutSource(
      'write-up',
      bytes({ text: 'A strong finish.', templateId: 'ride-write-up', source: 'computer' }),
    );
    expect(cut).toEqual({ kind: 'passages', passages: ['A strong finish.'] });
  });

  it('takes each of a ride summary’s passages, as the device built them', () => {
    const cut = cutSource(
      'ride-summary',
      bytes({
        format: 'onyourleft.ride-summary',
        version: 1,
        passages: ['Whole ride.', 'Climb.', 7],
      }),
    );
    expect(cut).toEqual({ kind: 'passages', passages: ['Whole ride.', 'Climb.'] });
  });

  it('takes a goal, note or document’s text, as JSON or as plain text, unfiltered', () => {
    expect(cutSource('note', bytes({ text: 'Knee felt odd on Tuesday.' }))).toEqual({
      kind: 'passages',
      passages: ['Knee felt odd on Tuesday.'],
    });
    expect(cutSource('document', bytes('Week 1: base.\n\nWeek 2: build.'))).toEqual({
      kind: 'passages',
      passages: ['Week 1: base.\n\nWeek 2: build.'],
    });
    expect(cutSource('goal', bytes({ other: 1 }))).toEqual({ kind: 'empty' });
  });

  it('finds nothing in a write-up with no text, or bytes that are not UTF-8', () => {
    expect(cutSource('write-up', bytes({}))).toEqual({ kind: 'empty' });
    expect(cutSource('write-up', bytes('not json'))).toEqual({ kind: 'empty' });
    expect(cutSource('note', new Uint8Array([0xff, 0xfe, 0x00]))).toEqual({ kind: 'empty' });
    expect(cutSource('note', bytes({ text: '   ' }))).toEqual({ kind: 'empty' });
  });

  it('never indexes an item carrying a picture, in any kind (ADR 0040 D-2 item 1)', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(cutSource('document', bytes(`My fit: ${png}`))).toEqual({ kind: 'picture' });
    expect(cutSource('note', bytes({ text: `see ${png}` }))).toEqual({ kind: 'picture' });
    expect(cutSource('write-up', bytes({ text: 'x', extra: png }))).toEqual({ kind: 'picture' });
    // The control: the word "data" is not a picture.
    expect(cutSource('note', bytes({ text: 'The data: power held.' })).kind).toBe('passages');
  });

  it('finds a picture behind a JSON escape, and one with no media type — #918 item 1', () => {
    // The two bodies #917's review got past the raw-text check. A JSON `\u003a`
    // is a colon only once the body is parsed.
    const escaped = '{"text":"see data\\u003aimage/png;base64,iVBORw0KGgo="}';
    expect(JSON.parse(escaped)).toEqual({ text: 'see data:image/png;base64,iVBORw0KGgo=' });
    expect(cutSource('note', bytes(escaped))).toEqual({ kind: 'picture' });
    // RFC 2397: `data:[<mediatype>][;base64],<data>` — the type may be left out.
    expect(cutSource('document', bytes('pasted data:;base64,iVBORw0KGgo='))).toEqual({
      kind: 'picture',
    });
    expect(cutSource('note', bytes({ text: 'data:,plain' }))).toEqual({ kind: 'picture' });
    // In a key, and deep in a ride summary's other fields.
    expect(cutSource('write-up', bytes({ text: 'x', ['data:;base64,AA==']: 1 }))).toEqual({
      kind: 'picture',
    });
    expect(
      cutSource('ride-summary', bytes({ passages: ['ok'], more: [[{ a: 'data:image/png,x' }]] })),
    ).toEqual({ kind: 'picture' });
  });

  it('matches what /\\bdata:[^,\\s]*,/iu matches, and nothing else', () => {
    const pattern = /\bdata:[^,\s]*,/iu;
    for (const text of [
      'data:image/png;base64,AA',
      'DATA:;base64,AA',
      'data:,',
      'x data:a/b c, then a comma',
      'data: , spaced',
      'metadata:x/y,',
      'data:a/data:b,',
      'data:\u00a0,',
      'data:a/b',
      'no scheme at all, here',
      'data:x data:y,',
    ]) {
      expect(holdsDataUrl(text), text).toBe(pattern.test(text));
    }
  });

  it('looks for a picture in linear time, however the body is made — #924 item 7', () => {
    // Each of these took seconds under a regular expression (passages.ts
    // §holdsDataUrl has the figures): 74 s, 4.4 s and 6.1 s at this size. The
    // scan takes milliseconds; the bound is generous for a slow runner and
    // still far under any of them.
    const size = MAXIMUM_SOURCE_CHARACTERS - 10;
    for (const hostile of [
      `data:a/${'a'.repeat(size)}`,
      'data:a/'.repeat(Math.floor(size / 7)),
      'data:'.repeat(Math.floor(size / 5)),
    ]) {
      const started = performance.now();
      expect(holdsDataUrl(hostile)).toBe(false);
      expect(cutSource('document', bytes(hostile)).kind).not.toBe('picture');
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });

  it('refuses a body longer than it reads before it looks for anything in it — #924 item 7', () => {
    // A body whose TEXT is short, padded past the limit in a field nothing
    // reads: were the length not checked first, it would be parsed and
    // scanned whole, and cut into one passage.
    const padded = { text: 'Short.', pad: ' '.repeat(MAXIMUM_SOURCE_CHARACTERS) };
    expect(cutSource('note', bytes(padded))).toEqual({ kind: 'too-long' });
    expect(cutSource('note', bytes({ ...padded, pad: '' }))).toEqual({
      kind: 'passages',
      passages: ['Short.'],
    });
    // One under is read: a picture there is still a picture.
    const picture = `data:,${'x'.repeat(MAXIMUM_SOURCE_CHARACTERS - 6)}`;
    expect(picture.length).toBe(MAXIMUM_SOURCE_CHARACTERS);
    expect(cutSource('document', bytes(picture))).toEqual({ kind: 'picture' });
  });

  it('reads a body nested deeper than any stack, rather than throwing on it', () => {
    const deep = `${'['.repeat(100_000)}"data:,x"${']'.repeat(100_000)}`;
    expect(cutSource('ride-summary', bytes(deep))).toEqual({ kind: 'picture' });
  });

  it('refuses an item that would take more passages than one item may, rather than keeping part of it', () => {
    const paragraph = `${'word '.repeat(170).trim()}.`;
    const long = Array.from({ length: MAXIMUM_PASSAGES_PER_SOURCE + 1 }, () => paragraph).join(
      '\n\n',
    );
    expect(cutSource('document', bytes(long))).toEqual({ kind: 'too-long' });
  });
});

describe('a block, split', () => {
  it('keeps a short block whole', () => {
    expect(splitBlock('  Short.  ')).toStrictEqual(['Short.']);
  });

  it('splits at a paragraph, then a sentence, then a space — never past the limit, never losing a word', () => {
    const sentence = 'The climb went well and the cadence held steady throughout. ';
    const block = `${sentence.repeat(20)}\n\n${sentence.repeat(3)}`;
    const passages = splitBlock(block);
    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) {
      expect(passage.length).toBeLessThanOrEqual(MAXIMUM_PASSAGE_CHARACTERS);
      expect(passage.endsWith('.')).toBe(true);
    }
    expect(passages.join(' ').replace(/\s+/g, ' ')).toBe(block.replace(/\s+/g, ' ').trim());
  });

  it('cuts a word with no space in it at the limit, and never through a surrogate pair', () => {
    const passages = splitBlock('🚲'.repeat(600));
    for (const passage of passages) {
      expect(passage.length).toBeLessThanOrEqual(MAXIMUM_PASSAGE_CHARACTERS);
      expect(passage.length % 2).toBe(0);
    }
    expect(passages.join('')).toBe('🚲'.repeat(600));
  });
});
