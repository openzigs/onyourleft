// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the credits screen is derived from, and the two ways that derivation
 * could be green while crediting nobody.
 *
 * - **An asset that owes attribution is dropped.** `creditsFrom` is the only
 *   place that decides which entries owe one, so a wrong answer here is an
 *   asset distributed unlicensed. Every case below that names `CC-BY-4.0`
 *   exists for that.
 * - **The set of attribution-requiring licences drifts from the gate's.**
 *   `check-repo-rules.sh` §`ASSET_LICENCES_ATTRIBUTED` decides which entries
 *   `ASSET006` demands the keys on; {@link ATTRIBUTION_LICENCES} decides which
 *   ones the screen credits. If the two disagree the build stays green and the
 *   obligation goes unmet, which is exactly the hazard `CLAUDE.md` §4g records
 *   between ADR 0015's tables and `POLICY`. The last case in this file is the
 *   assertion rather than the description.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ATTRIBUTION_LICENCES, creditsFrom, externalLink, licenceLink } from './credits';
import { parseAssetManifest } from './manifest';

function credits(lines: readonly string[]): ReturnType<typeof creditsFrom> {
  return creditsFrom(parseAssetManifest(lines.join('\n')));
}

/** An entry, with whatever keys a case wants to leave off. */
function entry(fields: Readonly<Record<string, string>>): readonly string[] {
  return ['[[asset]]', ...Object.entries(fields).map(([key, value]) => `${key} = "${value}"`)];
}

const A_CC_BY = entry({
  path: 'apps/web/src/game/models/rider.glb',
  source: 'Someone Else, on a model site',
  licence: 'CC-BY-4.0',
  read: '2026-09-18',
  sha256: 'aa',
  creator: 'Someone Else',
  url: 'https://example.invalid/rider',
  modified: 'merged into one geometry and rescaled',
});

const A_CC0 = entry({
  path: 'apps/web/src/game/models/tree_default.glb',
  source: 'Kenney Nature Kit',
  licence: 'CC0-1.0',
  read: '2026-09-17',
  sha256: 'bb',
  creator: 'Kenney',
  url: 'https://kenney.nl/assets/nature-kit',
  modified: 'no',
});

const A_FIXTURE = entry({
  path: 'packages/fit/fixtures/corpus/header-only.fit',
  source: 'This repository, #107',
  licence: 'Apache-2.0',
  read: '2026-09-16',
  sha256: 'cc',
});

describe('which assets are credited', () => {
  it('credits an asset whose licence requires attribution', () => {
    const { required } = credits(A_CC_BY);
    expect(required).toHaveLength(1);
    expect(required[0]?.creator).toBe('Someone Else');
    expect(required[0]?.url).toBe('https://example.invalid/rider');
    expect(required[0]?.modified).toBe('merged into one geometry and rescaled');
    expect(required[0]?.files).toEqual(['apps/web/src/game/models/rider.glb']);
  });

  it('credits an asset that records a creator but owes nothing, as a courtesy', () => {
    const { required, courtesy } = credits(A_CC0);
    expect(required).toEqual([]);
    expect(courtesy).toHaveLength(1);
    expect(courtesy[0]?.creator).toBe('Kenney');
  });

  it('leaves out an asset with nobody to credit', () => {
    // A fixture this repository generated. Listing it would pad the screen
    // with rows that credit us to ourselves, and the manifest carries no
    // creator for it precisely because there is none.
    expect(credits(A_FIXTURE)).toMatchObject({ required: [], courtesy: [] });
  });

  it('keeps the two lists apart, so a courtesy row cannot read as an obligation', () => {
    const { required, courtesy } = credits([...A_CC_BY, ...A_CC0, ...A_FIXTURE]);
    expect(required.map((work) => work.licence)).toEqual(['CC-BY-4.0']);
    expect(courtesy.map((work) => work.licence)).toEqual(['CC0-1.0']);
  });

  it('gathers the files of one work into one credit rather than repeating it', () => {
    // CC BY 4.0 §3(a)(1) attributes a *work*. Four files out of one pack are
    // one credit with four files under it, not four credits.
    const second = entry({
      path: 'apps/web/src/game/models/plant_bush.glb',
      source: 'Kenney Nature Kit',
      licence: 'CC0-1.0',
      read: '2026-09-17',
      sha256: 'dd',
      creator: 'Kenney',
      url: 'https://kenney.nl/assets/nature-kit',
      modified: 'no',
    });
    const { courtesy } = credits([...A_CC0, ...second]);
    expect(courtesy).toHaveLength(1);
    expect(courtesy[0]?.files).toEqual([
      'apps/web/src/game/models/tree_default.glb',
      'apps/web/src/game/models/plant_bush.glb',
    ]);
  });

  it('keeps two works of the same creator apart when they are different material', () => {
    // Kenney publishes many packs and each has its own page. One credit
    // pointing at one of them would be a link to material the other row is not.
    const city = entry({
      path: 'apps/web/src/game/models/building-type-h.glb',
      source: 'Kenney City Kit',
      licence: 'CC0-1.0',
      read: '2026-09-17',
      sha256: 'ee',
      creator: 'Kenney',
      url: 'https://kenney.nl/assets/city-kit-suburban',
      modified: 'no',
    });
    const { courtesy } = credits([...A_CC0, ...city]);
    expect(courtesy).toHaveLength(2);
  });
});

describe('an entry that owes attribution and does not carry it', () => {
  // `ASSET006` makes each of these a red build, so none of them can reach
  // `main`. The screen still refuses to paper over one: a row with no creator
  // rendered as though it were complete is the app asserting an attribution it
  // does not have, and dropping the row is worse still.
  const missing = (key: 'creator' | 'url' | 'modified'): ReturnType<typeof creditsFrom> => {
    const kept = A_CC_BY.filter((line) => !line.startsWith(`${key} =`));
    return credits(kept);
  };

  for (const key of ['creator', 'url', 'modified'] as const) {
    it(`still lists it, and says the ${key} is missing`, () => {
      const result = missing(key);
      expect(result.required).toHaveLength(1);
      expect(result.problems.join('\n')).toContain(key);
      expect(result.problems.join('\n')).toContain('apps/web/src/game/models/rider.glb');
    });
  }

  it('does not complain about the same keys on an asset that owes nothing', () => {
    expect(credits(A_FIXTURE).problems).toEqual([]);
  });

  it('carries a line the manifest could not be read at through to the screen', () => {
    // A dropped entry is an asset credited nowhere, so the reader's problems
    // are the screen's problems.
    expect(credits(['nonsense']).problems.join('\n')).toContain('nonsense');
  });
});

describe('the licence a credit names', () => {
  it('links the licence text for the two Creative Commons deeds in the tree', () => {
    expect(licenceLink('CC-BY-4.0')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(licenceLink('CC0-1.0')).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
  });

  it('gives no link for a licence it has no canonical URL for', () => {
    // The identifier alone is still an honest statement; a guessed URL is not.
    expect(licenceLink('MIT')).toBeUndefined();
    expect(licenceLink('Apache-2.0')).toBeUndefined();
  });

  it('has a link for every licence that requires attribution', () => {
    // CC BY 4.0 §3(a)(1)(A)(iii) wants a notice referring to the licence, and
    // the licence text is what that notice is for. A newly admitted
    // attribution licence with no link here would ship a notice pointing at
    // nothing.
    for (const licence of ATTRIBUTION_LICENCES) {
      expect(licenceLink(licence), `no licence text linked for ${licence}`).toBeDefined();
    }
  });
});

describe('a link the screen is willing to render', () => {
  it('passes an ordinary http or https link through', () => {
    expect(externalLink('https://kenney.nl/assets/nature-kit')).toBe(
      'https://kenney.nl/assets/nature-kit',
    );
    expect(externalLink('http://example.invalid/x')).toBe('http://example.invalid/x');
  });

  it('refuses a scheme that would execute rather than navigate', () => {
    // `ASSETS.toml` is committed, reviewed source — and a `url` is the one
    // field on this page that reaches the DOM as an attribute rather than as
    // text, and React escapes text without refusing this scheme.
    expect(externalLink('javascript:alert(1)')).toBeUndefined();
    expect(externalLink('JavaScript:alert(1)')).toBeUndefined();
    expect(externalLink('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(externalLink('/not/absolute')).toBeUndefined();
  });

  it('answers nothing for an entry that records no link at all', () => {
    expect(externalLink(undefined)).toBeUndefined();
  });
});

describe('the set of attribution-requiring licences matches the gate’s', () => {
  it('is exactly `ASSET_LICENCES_ATTRIBUTED` from check-repo-rules.sh', () => {
    // ⚠️ Two lists, one rule. `ASSET006` demands the keys on the shell's set;
    // this screen credits on ours. Drift between them is silent in both
    // directions: a licence added there and not here is an asset whose keys
    // are checked and never rendered, and one added here and not there is a
    // row rendered from keys nothing requires. Read out of the script rather
    // than copied, which is the same move `check-a11y-suite.mjs` makes on
    // `package.json`.
    const script = readFileSync(
      fileURLToPath(new URL('../../../../scripts/check-repo-rules.sh', import.meta.url)),
      'utf8',
    );
    const declared = /^ASSET_LICENCES_ATTRIBUTED="([^"]*)"$/m.exec(script);
    expect(
      declared,
      'ASSET_LICENCES_ATTRIBUTED is no longer declared in the script',
    ).not.toBeNull();
    expect((declared?.[1] ?? '').split(/\s+/).filter(Boolean).toSorted()).toEqual(
      [...ATTRIBUTION_LICENCES].toSorted(),
    );
  });
});
