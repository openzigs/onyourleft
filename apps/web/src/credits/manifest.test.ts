// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The reader for the subset of TOML `ASSETS.toml` is written in.
 *
 * ⚠️ **Every rejection here is also a rejection in
 * `scripts/check-repo-rules.sh` §`asset_manifest_records`**, and the two are
 * written from the same list on purpose: that one runs on a bare clone with no
 * toolchain and decides whether the build is red, this one runs in the client
 * and decides what a rider is shown. A file the shell refuses and this one
 * silently reads would be a credits screen making claims CI never checked; a
 * file the shell accepts and this one drops would be an asset credited nowhere,
 * which under [ADR 0023](../../../../docs/adr/0023-cc-by-assets-and-attribution.md)
 * is a licensing defect rather than a cosmetic one.
 *
 * So nothing here is skipped in silence. A line this parser cannot read becomes
 * a **problem**, the problem reaches the screen, and `CreditsView.test.tsx`
 * asserts that it does.
 */

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from './manifest';

/** One well-formed entry, as the manifest actually writes them. */
const ONE_ENTRY = [
  '# a comment, and a blank line follow',
  '',
  '[[asset]]',
  'path = "apps/web/src/game/models/tree_default.glb"',
  'source = "Kenney Nature Kit — https://kenney.nl/assets/nature-kit"',
  'licence = "CC0-1.0"',
  'read = "2026-09-17"',
  'sha256 = "562d29638c902de3c7bee465d3a53bb77117efbc392ae04ed894faf6b5dc691d"',
].join('\n');

describe('reading an entry', () => {
  it('reads every key of a well-formed entry', () => {
    const { entries, problems } = parseAssetManifest(ONE_ENTRY);
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('apps/web/src/game/models/tree_default.glb');
    expect(entries[0]?.licence).toBe('CC0-1.0');
    expect(entries[0]?.read).toBe('2026-09-17');
    expect(entries[0]?.sha256).toBe(
      '562d29638c902de3c7bee465d3a53bb77117efbc392ae04ed894faf6b5dc691d',
    );
    expect(entries[0]?.source).toContain('Kenney');
  });

  it('reads the three attribution keys ADR 0023 D-3 adds', () => {
    const { entries, problems } = parseAssetManifest(
      [
        '[[asset]]',
        'path = "apps/web/src/game/models/rider.glb"',
        'source = "somewhere"',
        'licence = "CC-BY-4.0"',
        'read = "2026-09-18"',
        'sha256 = "aa"',
        'creator = "A Person"',
        'url = "https://example.invalid/rider"',
        'modified = "rescaled and merged into one geometry"',
      ].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(entries[0]?.creator).toBe('A Person');
    expect(entries[0]?.url).toBe('https://example.invalid/rider');
    expect(entries[0]?.modified).toBe('rescaled and merged into one geometry');
  });

  it('reads several entries, keeping the order the manifest gives them', () => {
    const { entries } = parseAssetManifest(
      `${ONE_ENTRY}\n${ONE_ENTRY.replace('tree_default', 'plant_bush')}`,
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      'apps/web/src/game/models/tree_default.glb',
      'apps/web/src/game/models/plant_bush.glb',
    ]);
  });

  it('tolerates indentation, trailing whitespace and CRLF line endings', () => {
    const { entries, problems } = parseAssetManifest(
      ONE_ENTRY.split('\n')
        .map((line) => (line === '' ? line : `  ${line}  `))
        .join('\r\n'),
    );
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
  });
});

describe('a line the shell checker would refuse is a problem here too', () => {
  const refused = (lines: readonly string[]): readonly string[] =>
    parseAssetManifest(lines.join('\n')).problems.map((problem) => problem.message);

  it('refuses an unknown key rather than ignoring it', () => {
    // The choice ADR 0017 D-4 made for the workout file, for the same reason:
    // a key nobody reads is a claim about an asset that silently has no effect.
    const problems = refused([
      '[[asset]]',
      'path = "apps/a.glb"',
      'source = "s"',
      'licence = "MIT"',
      'read = "2026-09-18"',
      'sha256 = "aa"',
      'attribution = "Someone"',
    ]);
    expect(problems.join('\n')).toContain('attribution');
  });

  it('refuses a key before any [[asset]] header', () => {
    expect(refused(['path = "apps/a.glb"']).join('\n')).toContain('before any');
  });

  it('refuses a table header that is not [[asset]]', () => {
    expect(refused(['[asset]']).join('\n')).toContain('[[asset]]');
  });

  it('refuses a line that is not a comment, a header or key = "value"', () => {
    expect(refused(['[[asset]]', 'path = apps/a.glb']).join('\n')).toContain('path = apps/a.glb');
  });

  it('refuses an empty value', () => {
    expect(refused(['[[asset]]', 'path = ""']).join('\n')).toContain('empty');
  });

  it('refuses a duplicate key in one entry', () => {
    expect(
      refused(['[[asset]]', 'path = "apps/a.glb"', 'path = "apps/b.glb"']).join('\n'),
    ).toContain('duplicate');
  });

  it('refuses an entry with no path, no source, or no read date', () => {
    expect(refused(['[[asset]]', 'source = "s"']).join('\n')).toContain('no path');
    expect(refused(['[[asset]]', 'path = "apps/a.glb"']).join('\n')).toContain('no source');
    expect(
      refused([
        '[[asset]]',
        'path = "apps/a.glb"',
        'source = "s"',
        'read = "17 September 2026"',
      ]).join('\n'),
    ).toContain('read date');
  });

  it('drops an entry it refused, so a half-read entry never reaches the screen', () => {
    // The shell's `flush()` does the same. A row missing its source is a row
    // whose provenance nobody wrote down, and rendering it would be the app
    // asserting something the manifest does not say.
    //
    // ⚠️ **Every other key present**, which is what makes this a test of the
    // drop rather than of the next check along: an entry missing its source
    // *and* its read date is refused either way, so a version of this case
    // that left both off went green against an implementation that kept the
    // entry. Found by mutation.
    const { entries, problems } = parseAssetManifest(
      [
        '[[asset]]',
        'path = "apps/a.glb"',
        'licence = "MIT"',
        'read = "2026-09-18"',
        'sha256 = "aa"',
      ].join('\n'),
    );
    expect(problems.map((problem) => problem.message).join('\n')).toContain('no source');
    expect(entries).toEqual([]);
  });

  it('names the line a problem was on, so it can be found', () => {
    const { problems } = parseAssetManifest(['# one', '', 'nonsense'].join('\n'));
    expect(problems[0]?.line).toBe(3);
  });

  it('carries on reading after a problem rather than stopping', () => {
    // The sticking-state failure this repository has now shipped five times —
    // DOC002's fence, XML003's CDATA. A parser that gives up at the first bad
    // line drops every asset after it while reporting one tidy message.
    //
    // ⚠️ **Two bad lines, not one**, and that is the whole case: a version
    // with a single bad line passed against a parser that recorded the first
    // problem and then went silent, because one problem is all there was to
    // record. Found by mutation.
    const { entries, problems } = parseAssetManifest(`nonsense\nalso nonsense\n${ONE_ENTRY}`);
    expect(problems.map((problem) => problem.line)).toEqual([1, 2]);
    expect(entries).toHaveLength(1);
  });
});
