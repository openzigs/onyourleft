// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The document the Credits screen renders is the document `check:notices`
 * holds — #664.
 *
 * Read back through the loader the screen uses, and compared byte for byte
 * with the committed file the generator writes and the build serves. A loader
 * that read anything else — the contents file, a stale copy, an empty string
 * — would render a rider a notices document the gate never checked.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadNoticesDocument } from './notices-document';

const COMMITTED = join(import.meta.dirname, '../../public/licences/third-party.txt');

describe('loadNoticesDocument (#664)', () => {
  it('reads the committed notices document, verbatim', async () => {
    const loaded = await loadNoticesDocument();
    expect(loaded).toBe(readFileSync(COMMITTED, 'utf8'));
  });

  it('is the whole document, licence text included, not only its contents', async () => {
    const loaded = await loadNoticesDocument();
    expect(loaded).toMatch(/^THIRD-PARTY SOFTWARE IN ON YOUR LEFT/);
    // The Lucide/Feather case: the MIT half of lucide-react's own LICENSE,
    // which its manifest's `ISC` does not say.
    expect(loaded).toContain('Cole Bemis');
    expect(loaded).toContain('Permission is hereby granted, free of charge');
  });
});
