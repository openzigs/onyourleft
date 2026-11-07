// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { noticeFiles, noticesDocument, packageRoot } from './notices-plugin';

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('the installed valhalla-browser', () => {
  it('has every licence text it ships in the document, verbatim', () => {
    const root = packageRoot();
    const document = noticesDocument(root);
    const shipped = readdirSync(join(root, 'dist', 'licenses'));
    // Spike 0035 counted fifteen texts and a notice in 0.2.1; a bump that drops one should be read, not passed.
    expect(shipped.length).toBeGreaterThanOrEqual(15);
    for (const file of [
      'LICENSE',
      'NOTICE.md',
      ...shipped.map((name) => `dist/licenses/${name}`),
    ]) {
      expect(document).toContain(`: ${file}\n`);
      expect(document).toContain(readFileSync(join(root, file), 'utf8').trimEnd());
    }
    expect(document).toContain('MIT License');
    expect(document).toContain('Boost Software License');
  });
});

describe('noticeFiles', () => {
  function fakePackage(licences: string[]): string {
    scratch = mkdtempSync(join(tmpdir(), 'oyl-notices-'));
    mkdirSync(join(scratch, 'dist', 'licenses'), { recursive: true });
    writeFileSync(
      join(scratch, 'package.json'),
      JSON.stringify({ name: 'valhalla-browser', version: '9.9.9' }),
    );
    writeFileSync(join(scratch, 'LICENSE'), 'the MIT text\n');
    writeFileSync(join(scratch, 'NOTICE.md'), 'the notice\n');
    for (const name of licences)
      writeFileSync(join(scratch, 'dist', 'licenses', name), `${name} text\n`);
    return scratch;
  }

  it('lists the licence, the notice and each compiled-in licence, sorted', () => {
    expect(noticeFiles(fakePackage(['zlib.txt', 'Boost.txt']))).toEqual([
      'LICENSE',
      'NOTICE.md',
      'dist/licenses/Boost.txt',
      'dist/licenses/zlib.txt',
    ]);
  });

  it('refuses a version that ships no compiled-in licences', () => {
    expect(() => noticeFiles(fakePackage([]))).toThrow('ships no dist/licenses/');
  });

  it('names the package and version on each section', () => {
    expect(noticesDocument(fakePackage(['zlib.txt']))).toContain(
      'valhalla-browser@9.9.9: dist/licenses/zlib.txt\n',
    );
  });
});
