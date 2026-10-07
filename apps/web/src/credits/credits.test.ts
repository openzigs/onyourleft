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
 *   obligation goes unmet, which is exactly the hazard `docs/agents/licence-gates.md` §4g records
 *   between ADR 0015's tables and `POLICY`. The last case in this file is the
 *   assertion rather than the description.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTION_LICENCES,
  creditsFrom,
  externalLink,
  LICENCE_COPY_LICENCES,
  licenceLink,
  licenceTerms,
  NOTHING_ASKED_LICENCES,
  SHIPPED_LICENCE_TEXTS,
} from './credits';
import { LICENCE_BODY_STARTS } from '../../tools/fonts/font-recipe';
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

const AN_APACHE = entry({
  path: 'apps/web/public/glyphs/Roboto-Regular/0-255.pbf',
  source: 'Roboto v2.138 Regular, rasterised by this repository',
  licence: 'Apache-2.0',
  read: '2026-09-26',
  sha256: 'ee',
  creator: 'Christian Robertson for Google',
  url: 'https://github.com/googlefonts/roboto-2/releases/tag/v2.138',
  modified: 'rasterised',
});

const AN_MIT = entry({
  path: 'apps/mobile/android/app/src/main/res/drawable/splash.png',
  source: 'the Capacitor Android template',
  licence: 'MIT',
  read: '2026-09-16',
  sha256: 'ff',
  creator: 'Ionic',
  url: 'https://github.com/ionic-team/capacitor',
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

  it('lists an Apache-2.0 work apart from the courtesy list, with its licence copy — #597', () => {
    // Apache-2.0 §4(a) asks for the licence text to travel with the work. The
    // courtesy section says its licences ask for nothing, so an Apache-2.0
    // work under it was the screen denying an obligation that exists.
    const { required, licenceCopy, courtesy, problems } = credits([...AN_APACHE, ...A_CC0]);
    expect(required).toEqual([]);
    expect(licenceCopy.map((work) => work.creator)).toEqual(['Christian Robertson for Google']);
    expect(licenceCopy[0]?.terms).toBe('licence-copy');
    expect(courtesy.map((work) => work.licence)).toEqual(['CC0-1.0']);
    expect(problems).toEqual([]);
  });

  it('puts a licence it has not been told about in neither list, and says so', () => {
    // The courtesy list is an allowlist. MIT asks for its notice to travel
    // with the work, so "everything not CC BY is a courtesy" would put it
    // under a sentence saying it asks for nothing.
    const { licenceCopy, courtesy, unclassified, problems } = credits(AN_MIT);
    expect(licenceCopy).toEqual([]);
    expect(courtesy).toEqual([]);
    expect(unclassified.map((work) => work.licence)).toEqual(['MIT']);
    expect(problems.join('\n')).toContain(
      'apps/mobile/android/app/src/main/res/drawable/splash.png is under MIT, and this page has not been told',
    );
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

  it('gives no link for a licence it has no canonical URL or shipped copy for', () => {
    // The identifier alone is still an honest statement; a guessed URL is not.
    expect(licenceLink('MIT')).toBeUndefined();
  });

  it('links Apache-2.0 to the copy this app ships, relative to the page — #597', () => {
    expect(licenceLink('Apache-2.0')).toBe('./licences/Apache-2.0.txt');
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

describe('the licence texts this app ships — #597', () => {
  const publicDirectory = new URL('../../public/', import.meta.url);
  const canonical = new URL('../../../../LICENSES/', import.meta.url);

  it('has a shipped copy for every licence that asks for one to travel with the work', () => {
    for (const licence of LICENCE_COPY_LICENCES) {
      expect(SHIPPED_LICENCE_TEXTS[licence], `no shipped copy of ${licence}`).toBeDefined();
    }
  });

  /**
   * The canonical text each shipped copy is held to: `LICENSES/` for the
   * repository's own licences, whose digests `LIC005` pins, and for OFL-1.1
   * (#991) the licence's own text out of the committed upstream `OFL.txt`,
   * whose digest `tools/fonts/fonts.test.ts` pins, from its first line down.
   */
  function canonicalText(licence: string): Buffer {
    if (licence === 'OFL-1.1') {
      const upstream = readFileSync(
        fileURLToPath(new URL('../../tools/fonts/barlow/OFL.txt', import.meta.url)),
        'utf8',
      );
      const at = upstream.indexOf(LICENCE_BODY_STARTS);
      expect(at, 'the upstream OFL.txt does not hold the licence’s first line').toBeGreaterThan(0);
      return Buffer.from(upstream.slice(at), 'utf8');
    }
    return readFileSync(fileURLToPath(new URL(`${licence}.txt`, canonical)));
  }

  it('names files that are in `public/`, byte-identical to the canonical texts', () => {
    // Relative to the page, so what `public/` holds is what `dist` serves.
    // The bytes are the text `LIC005` pins by digest in ADR 0001, so a copy
    // that was retyped, rewrapped or truncated is a red test rather than a
    // licence text that is not quite the licence.
    const shipped = Object.entries(SHIPPED_LICENCE_TEXTS);
    expect(shipped.length).toBeGreaterThan(0);
    for (const [licence, link] of shipped) {
      expect(link.startsWith('./'), `${link} is not relative to the page`).toBe(true);
      const bytes = readFileSync(fileURLToPath(new URL(link.slice(2), publicDirectory)));
      const expected = canonicalText(licence);
      expect(bytes.equals(expected), `${link} is not the canonical ${licence} text`).toBe(true);
    }
  });

  it('keeps the three sets of licences apart', () => {
    for (const licence of [
      ...ATTRIBUTION_LICENCES,
      ...LICENCE_COPY_LICENCES,
      ...NOTHING_ASKED_LICENCES,
    ]) {
      expect(
        [ATTRIBUTION_LICENCES, LICENCE_COPY_LICENCES, NOTHING_ASKED_LICENCES].filter((set) =>
          set.includes(licence),
        ),
        `${licence} is in more than one set`,
      ).toHaveLength(1);
    }
    expect(licenceTerms('Apache-2.0')).toBe('licence-copy');
    expect(licenceTerms('OFL-1.1')).toBe('licence-copy');
    // Equality, never a prefix: a Reserved-Font-Name face is not this one.
    expect(licenceTerms('OFL-1.1-RFN')).toBe('unclassified');
    expect(licenceTerms('CC0-1.0')).toBe('nothing');
    expect(licenceTerms('CC-BY-4.0')).toBe('attribution');
    expect(licenceTerms('MIT')).toBe('unclassified');
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
