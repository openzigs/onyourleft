// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a file a rider adds as a document may be (#836): plain text or
 * Markdown, UTF-8, no picture, within the limit — each refusal at its edge.
 */

import { MAXIMUM_DOCUMENT_CHARACTERS, MAXIMUM_DOCUMENT_NAME_CHARACTERS } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_ACCEPT,
  DOCUMENT_REFUSAL_TEXT,
  documentFileRefusal,
  isDocumentName,
  MAXIMUM_DOCUMENT_BYTES,
  readDocument,
} from './document-file';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('a document file (#836)', () => {
  it('reads a Markdown or a text file as its text, tidied, and keeps its name', () => {
    expect(readDocument('Plan.MD', bytes('﻿# Plan\r\n\r\nWeek 1:\tride.\r\n'))).toStrictEqual({
      kind: 'document',
      name: 'Plan.MD',
      text: '# Plan\n\nWeek 1:\tride.',
    });
    expect(readDocument(' notes.txt ', bytes('Easy days easy.'))).toMatchObject({
      kind: 'document',
      name: 'notes.txt',
    });
    expect(isDocumentName('plan.markdown')).toBe(true);
  });

  it('refuses a PDF, a Word file or a picture by its name, before a byte is read', () => {
    for (const name of ['plan.pdf', 'plan.docx', 'plan.png', 'plan', 'plan.md.pdf']) {
      expect(documentFileRefusal(name, 10)).toBe('not-text');
      expect(readDocument(name, bytes('text'))).toStrictEqual({
        kind: 'refused',
        refusal: 'not-text',
      });
    }
    expect(DOCUMENT_ACCEPT).toBe('.txt,.md,.markdown,text/plain,text/markdown');
  });

  it('refuses bytes that are not UTF-8, rather than guessing an encoding', () => {
    // "café" in Latin-1: 0xE9 alone is not UTF-8.
    expect(readDocument('plan.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toStrictEqual({
      kind: 'refused',
      refusal: 'not-utf8',
    });
  });

  it('refuses a binary file renamed .txt, and a picture inside Markdown', () => {
    expect(readDocument('plan.txt', bytes('PK\u0003\u0004zip'))).toMatchObject({
      refusal: 'binary',
    });
    expect(
      readDocument('plan.md', bytes('Look: ![me](data:image/png;base64,iVBORw0KGgo=)')),
    ).toMatchObject({ refusal: 'picture' });
  });

  it('refuses a picture however its data URL is spelled after the slash', () => {
    for (const url of [
      'data:image/svg+xml;utf8,<svg/>',
      'data:image/png;name=me.png;base64,iVBORw0KGgo=',
      'DATA:IMAGE/JPEG,abc',
    ]) {
      expect(readDocument('plan.md', bytes(`![me](${url})`))).toMatchObject({ refusal: 'picture' });
    }
    // Not a data URL: no slash, or no comma.
    expect(readDocument('plan.md', bytes('data: none today'))).toMatchObject({ kind: 'document' });
    expect(readDocument('plan.md', bytes('metadata:x/y and more'))).toMatchObject({
      kind: 'document',
    });
  });

  it('checks the length before it looks for a picture, so the scan is bounded', () => {
    // A picture past the limit is refused as too long: the regular expressions
    // never run over more than MAXIMUM_DOCUMENT_CHARACTERS (#920's review).
    expect(
      readDocument('plan.md', bytes(`data:a/${'a'.repeat(MAXIMUM_DOCUMENT_CHARACTERS)},`)),
    ).toMatchObject({ refusal: 'too-long' });
  });

  it('looks for a picture in linear time, however the file is made (#920 review)', () => {
    // `data:a/` and then a long run with no comma is the input the old pattern,
    // /data:[a-z0-9.+-]*\/[a-z0-9.+-]*[^,\s]*,/, took quadratic time over: two
    // quantifiers after the slash that both match `a`, retried at every split.
    // Measured in Node 24 on a Mac: 6.7 s for 100 000 characters, on the main
    // thread. The pattern shipped takes about a millisecond. The bound is
    // generous for a slow runner and still several times under the old cost.
    const hostile = `data:a/${'a'.repeat(MAXIMUM_DOCUMENT_CHARACTERS - 7)}`;
    const started = performance.now();
    expect(readDocument('plan.md', bytes(hostile))).toMatchObject({ kind: 'document' });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('drops a bidirectional override from a name, so it is kept as it really reads', () => {
    expect(readDocument(' evil\u202Egnp.md', bytes('text'))).toMatchObject({
      kind: 'document',
      name: 'evilgnp.md',
    });
    expect(readDocument('\u2066plan\u2069.md', bytes('text'))).toMatchObject({ name: 'plan.md' });
    expect(documentFileRefusal('plan.md\u202C', 4)).toBeUndefined();
  });

  it('refuses an empty file', () => {
    expect(readDocument('plan.md', bytes(' \r\n\t '))).toMatchObject({ refusal: 'empty' });
  });

  it('keeps exactly MAXIMUM_DOCUMENT_CHARACTERS and refuses one more', () => {
    expect(readDocument('plan.txt', bytes('x'.repeat(MAXIMUM_DOCUMENT_CHARACTERS)))).toMatchObject({
      kind: 'document',
    });
    expect(
      readDocument('plan.txt', bytes('x'.repeat(MAXIMUM_DOCUMENT_CHARACTERS + 1))),
    ).toMatchObject({ refusal: 'too-long' });
    // Counted in characters, not bytes: 100 000 three-byte characters are kept.
    expect(readDocument('plan.txt', bytes('€'.repeat(MAXIMUM_DOCUMENT_CHARACTERS)))).toMatchObject({
      kind: 'document',
    });
    expect(documentFileRefusal('plan.txt', MAXIMUM_DOCUMENT_BYTES + 1)).toBe('too-long');
    expect(documentFileRefusal('plan.txt', MAXIMUM_DOCUMENT_BYTES)).toBeUndefined();
  });

  it('refuses a name too long to keep', () => {
    const name = `${'n'.repeat(MAXIMUM_DOCUMENT_NAME_CHARACTERS)}.md`;
    expect(documentFileRefusal(name, 1)).toBe('name-too-long');
  });

  it('says every refusal in a sentence that repeats nothing of the file', () => {
    for (const text of Object.values(DOCUMENT_REFUSAL_TEXT)) {
      expect(text).toMatch(/\.$/u);
    }
    expect(DOCUMENT_REFUSAL_TEXT['too-long']).toContain('100,000 characters');
  });
});
