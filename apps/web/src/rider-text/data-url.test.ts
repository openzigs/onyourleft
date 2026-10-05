// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The client's `data:` URL scan (#933): what it matches, that it is linear,
 * and that it is the instance's scan, character for character.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MAXIMUM_DOCUMENT_CHARACTERS } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { holdsDataUrl } from './data-url';

/** A file's code with every comment and blank line taken out. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/u, '').trimEnd())
    .filter((line) => line !== '')
    .join('\n');
}

/** The two constants and the function the scan is, from a file's code. */
function scanIn(source: string): string {
  const code = codeOf(source);
  const pieces = [
    /^const DATA_SCHEME = .*$/mu,
    /^const HEADER_END = .*$/mu,
    /^export function holdsDataUrl\(text: string\): boolean \{\n[\s\S]*?\n\}$/mu,
  ].map((pattern) => pattern.exec(code)?.[0]);
  for (const piece of pieces) expect(piece, 'a piece of the scan was not found').toBeDefined();
  return pieces.join('\n');
}

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('holdsDataUrl — #933', () => {
  it('is the instance’s scan, so a document the client admits is one the instance indexes', () => {
    const client = scanIn(read('./data-url.ts'));
    const instance = scanIn(read('../../../instance/src/history/passages.ts'));
    expect(client).toBe(instance);
    // The control: a scan that differs by one character is told apart.
    expect(scanIn(read('./data-url.ts').replace("=== ','", "=== ';'"))).not.toBe(instance);
  });

  it('matches what /\\bdata:[^,\\s]*,/iu matches, and nothing else', () => {
    const pattern = /\bdata:[^,\s]*,/iu;
    for (const text of [
      'data:image/png;base64,AA',
      'DATA:;base64,AA',
      'data:;base64,iVBORw0KGgo=',
      'data:,',
      'x data:a/b c, then a comma',
      'data: , spaced',
      'metadata:x/y,',
      'data:a/data:b,',
      'data: ,',
      'data:a/b',
      'no scheme at all, here',
      'data:x data:y,',
    ]) {
      expect(holdsDataUrl(text), text).toBe(pattern.test(text));
    }
  });

  it('finds a data: URL with no media type, which RFC 2397 allows', () => {
    expect(holdsDataUrl('![me](data:;base64,iVBORw0KGgo=)')).toBe(true);
    expect(holdsDataUrl('data:,plain')).toBe(true);
  });

  it('takes linear time, however the text is made', () => {
    // #920's pattern took 0.86 s on `data:a/` repeated to this length (Node 24,
    // measured for #933), and was seen red here; the scan takes a few
    // milliseconds. The bound is generous for a slow runner under coverage and
    // still far under the old cost.
    const size = MAXIMUM_DOCUMENT_CHARACTERS;
    for (const hostile of [
      'data:a/'.repeat(Math.floor(size / 7)),
      'data:'.repeat(Math.floor(size / 5)),
      `data:a/${'a'.repeat(size - 7)}`,
    ]) {
      const started = performance.now();
      expect(holdsDataUrl(hostile)).toBe(false);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});
