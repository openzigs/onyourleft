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

import { loadNoticesDocument, loadRoutingNoticesDocument } from './notices-document';

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

describe('loadRoutingNoticesDocument (#2734)', () => {
  const ROUTING = join(import.meta.dirname, '../../public/routing/third-party.txt');
  const INPUTS = join(import.meta.dirname, '../../third-party-notices.json');

  it('reads the committed engine licence texts, verbatim', async () => {
    expect(await loadRoutingNoticesDocument()).toBe(readFileSync(ROUTING, 'utf8'));
  });

  it('carries every licence text the reviewed entry names, and the notices name the file they are in', async () => {
    const inputs = JSON.parse(readFileSync(INPUTS, 'utf8')) as {
      copiedIntoBuild: {
        vendored?: { document?: string; upstream?: { url: string; text: string }[] };
      }[];
    };
    const separate = inputs.copiedIntoBuild.filter(
      (file) => file.vendored?.document === 'routing/third-party.txt',
    );
    expect(separate).toHaveLength(1);
    const upstream = separate[0]?.vendored?.upstream ?? [];
    expect(upstream.length).toBeGreaterThan(10);
    const routing = await loadRoutingNoticesDocument();
    const notices = await loadNoticesDocument();
    for (const text of upstream) {
      // Line endings normalised, as the generator does; the words untouched.
      const words = text.text.replace(/\r\n?/g, '\n').replace(/^\u{FEFF}/u, '').trim();
      expect(routing, text.url).toContain(words);
      expect(notices, text.url).toContain(`from ${text.url}`);
    }
    expect(notices).toContain('in routing/third-party.txt');
    // And the document itself no longer carries the largest of them.
    expect(notices).not.toContain('Boost Software License - Version 1.0');
  });
});
