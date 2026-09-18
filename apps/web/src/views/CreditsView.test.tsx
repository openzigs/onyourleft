// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The credits screen, and the four ways it could be green while crediting
 * nobody — #358.
 *
 * ⚠️ **A screen that renders nothing looks exactly like a correct one today.**
 * There is no `CC-BY-4.0` asset in the tree ([ADR 0023](../../../../docs/adr/0023-cc-by-assets-and-attribution.md)
 * D-7 makes this screen the thing that lands *before* the first one), so a
 * `CreditsView` that returned `null` would satisfy "every attribution-requiring
 * entry in the manifest appears" vacuously, for ever, until the day it was
 * silently wrong. That is #142's lesson in a new place and it is why:
 *
 * 1. the first suite renders a **fixture** manifest carrying a CC-BY entry and
 *    requires every part of the attribution on the screen — so dropping the
 *    required list, the creator, the link, the licence or the modification note
 *    is a red test today rather than the day an asset arrives;
 * 2. the second suite is the gate over the **real** manifest — every
 *    attribution-requiring row reaches the rendered screen — and it is written
 *    so that it is the fixture suite, not this one, that is doing the proving
 *    while the tree has no such row;
 * 3. the third suite asserts the screen says so *in words* when there is
 *    nothing it must credit, so an empty obligation is distinguishable from a
 *    broken screen by looking at it; and
 * 4. the fourth asserts the manifest reaches the bundle rather than the
 *    network, which is #358's second criterion.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSET_MANIFEST_SOURCE } from '../credits/source';
import { creditsFrom } from '../credits/credits';
import { parseAssetManifest } from '../credits/manifest';
import { mount, queryAll, type Mounted } from '../testing/mount';

import { CreditsView } from './CreditsView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function render(manifest?: string): Promise<Mounted> {
  const result = await mount(
    manifest === undefined ? <CreditsView /> : <CreditsView manifest={manifest} />,
  );
  mounted = result;
  return result;
}

function text(): string {
  return mounted?.container.textContent ?? '';
}

function hrefs(): readonly string[] {
  return queryAll<HTMLAnchorElement>(mounted?.container ?? document, 'a').map(
    (link) => link.getAttribute('href') ?? '',
  );
}

/** A manifest with one asset that owes attribution, and one that owes none. */
const FIXTURE = [
  '[[asset]]',
  'path = "apps/web/src/game/models/rider.glb"',
  'source = "A model site"',
  'licence = "CC-BY-4.0"',
  'read = "2026-09-18"',
  'sha256 = "aa"',
  'creator = "Ada Lovelace"',
  'url = "https://example.invalid/rider"',
  'modified = "merged into one geometry and rescaled"',
  '',
  '[[asset]]',
  'path = "apps/web/src/game/models/tree_default.glb"',
  'source = "Kenney Nature Kit"',
  'licence = "CC0-1.0"',
  'read = "2026-09-17"',
  'sha256 = "bb"',
  'creator = "Kenney"',
  'url = "https://kenney.nl/assets/nature-kit"',
  'modified = "no"',
].join('\n');

describe('an asset that must be credited', () => {
  it('names the creator, links the original, and names the licence', async () => {
    await render(FIXTURE);
    expect(text()).toContain('Ada Lovelace');
    expect(hrefs()).toContain('https://example.invalid/rider');
    expect(text()).toContain('CC-BY-4.0');
    // CC BY 4.0 §3(a)(1)(A)(iii) wants a notice referring to the licence, and
    // a reader can only act on one they can open.
    expect(hrefs()).toContain('https://creativecommons.org/licenses/by/4.0/');
  });

  it('says the asset was modified, which is the clause most often missed', async () => {
    // §3(a)(1)(B). ADR 0023 D-4: merging parts and rescaling both count, and
    // the manifest says which in words rather than "yes".
    await render(FIXTURE);
    expect(text()).toContain('merged into one geometry and rescaled');
  });

  it('carries the copyright, licence and warranty notices once, not per row', async () => {
    // ADR 0023 D-3: the two notices §3(a)(1)(A)(ii) and (iii) ask for are the
    // same sentence for every CC BY asset, so they are the screen's own wording
    // and cannot drift row by row.
    await render(FIXTURE);
    expect(text()).toContain('copyright');
    expect(text()).toMatch(/without warranties|as-is|as is/i);
  });

  it('names the file it took, so a credit points at something checkable', async () => {
    await render(FIXTURE);
    expect(text()).toContain('apps/web/src/game/models/rider.glb');
  });

  it('opens an external link in a new tab, and says so', async () => {
    // Inside the Android shell a plain link navigates the WebView the app is
    // running in away from the app — `AboutView` carries the same pair for the
    // same reason.
    await render(FIXTURE);
    const original = queryAll<HTMLAnchorElement>(mounted?.container ?? document, 'a').find(
      (link) => link.getAttribute('href') === 'https://example.invalid/rider',
    );
    expect(original?.getAttribute('target')).toBe('_blank');
    expect(original?.getAttribute('rel') ?? '').toContain('noreferrer');
    expect(text()).toContain('open in a new tab');
  });
});

describe('an asset that owes nothing', () => {
  it('is credited as a courtesy, under its own heading', async () => {
    await render(FIXTURE);
    expect(text()).toContain('Kenney');
    expect(text()).toMatch(/courtesy/i);
  });

  it('is not presented as an obligation', async () => {
    // #358's third bullet: the screen must not imply an obligation that does
    // not exist. The courtesy section says the licence asks for nothing, and
    // the two sections are separate.
    await render(FIXTURE);
    expect(text()).toMatch(/asks? for nothing|does not require/i);
  });

  it('says it was used unmodified where the manifest records `no`', async () => {
    await render(FIXTURE);
    expect(text()).toMatch(/unmodified/i);
  });
});

describe('the gate: every attribution-requiring row in ASSETS.toml reaches the screen', () => {
  it('credits each one by creator, link and file', async () => {
    // ⚠️ **Today this loop runs zero times**, because no `CC-BY-4.0` asset is
    // committed (ADR 0023 D-7). It is here so that the first one to arrive
    // cannot arrive uncredited, and the case below is what stops *this* one
    // being the only thing standing between the app and an unmet obligation.
    const { required } = creditsFrom(parseAssetManifest(ASSET_MANIFEST_SOURCE));
    await render();
    for (const work of required) {
      expect(text(), `${work.creator} is not on the credits screen`).toContain(work.creator);
      expect(hrefs(), `no link to ${work.url ?? '(none recorded)'}`).toContain(work.url);
      for (const file of work.files) {
        expect(text(), `${file} is credited to nobody`).toContain(file);
      }
    }
  });

  it('reads the real manifest with no problems at all', () => {
    // The other half of the same claim. A row this client cannot parse is
    // dropped, and a dropped row is an asset credited nowhere — so "no
    // attribution-requiring rows" has to mean the manifest was read, not that
    // reading it failed.
    const parsed = parseAssetManifest(ASSET_MANIFEST_SOURCE);
    expect(creditsFrom(parsed).problems).toEqual([]);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });

  it('credits the packs actually shipping in this build', async () => {
    // And the third half: the two suites above are both satisfied by a screen
    // that renders nothing, because the tree has no CC-BY asset. This one is
    // not — it names what is in the manifest today, so the screen has to have
    // read it.
    await render();
    expect(text()).toContain('Kenney');
    expect(text()).toContain('apps/web/src/game/models/tree_default.glb');
    expect(hrefs()).toContain('https://kenney.nl/assets/nature-kit');
  });
});

describe('when there is nothing the app must credit', () => {
  it('says so, rather than rendering an empty list', async () => {
    const onlyCourtesy = FIXTURE.split('\n').slice(10).join('\n');
    await render(onlyCourtesy);
    expect(creditsFrom(parseAssetManifest(onlyCourtesy)).required).toEqual([]);
    expect(text()).toMatch(/no asset in this (build|app)/i);
  });
});

describe('a manifest the client cannot fully read', () => {
  it('shows the problem instead of quietly crediting fewer people', async () => {
    await render(`nonsense\n${FIXTURE}`);
    expect(text()).toContain('nonsense');
    // And the rest of the manifest is still credited.
    expect(text()).toContain('Ada Lovelace');
  });

  it('shows an attribution-requiring entry whose keys are missing, and says which', async () => {
    // `ASSET006` makes this a red build, so it cannot ship. What it must not
    // do is render as though it were complete, or disappear.
    const missingCreator = FIXTURE.split('\n')
      .filter((line) => !line.startsWith('creator = "Ada'))
      .join('\n');
    await render(missingCreator);
    expect(text()).toContain('apps/web/src/game/models/rider.glb');
    // ⚠️ The **sentence**, not the word: an earlier version asserted only that
    // the page contained "creator", which the rest of the page satisfies on its
    // own, and it stayed green against a `creditsFrom` that reported nothing.
    // Found by mutation.
    expect(text()).toContain('records no creator');
  });
});

describe('what the screen refuses to invent', () => {
  it('renders no link at all for a url that is not a web address', async () => {
    // The other half of `externalLink`'s guard, at the place it matters: the
    // creator is still credited and the licence still named, and there is no
    // `href` carrying a scheme that executes.
    const hostile = FIXTURE.replace(
      'url = "https://example.invalid/rider"',
      'url = "javascript:alert(1)"',
    );
    await render(hostile);
    expect(text()).toContain('Ada Lovelace');
    expect(hrefs().join(' ')).not.toContain('javascript:');
  });

  it('names a creator with no link rather than guessing one', async () => {
    // A row whose `url` is missing is a red build (`ASSET006`), and the screen
    // still has to render *something* honest: the creator, and no link at all.
    const noUrl = FIXTURE.split('\n')
      .filter((line) => !line.startsWith('url = "https://example.invalid'))
      .join('\n');
    await render(noUrl);
    expect(text()).toContain('Ada Lovelace');
    expect(hrefs()).not.toContain('https://example.invalid/rider');
  });

  it('says a modification is unrecorded rather than calling it unmodified', async () => {
    // ⚠️ The two are different claims and only one of them is in the manifest.
    // ADR 0023 D-3 requires `modified = "no"` to be *written down* precisely so
    // that "nothing to declare" and "nobody said" stay distinguishable, and a
    // screen that collapsed them would undo that at the last step.
    const noNote = FIXTURE.split('\n')
      .filter((line) => !line.startsWith('modified = "merged'))
      .join('\n');
    await render(noNote);
    // The whole sentence: the CC0 row below it says "Used unmodified.", which
    // is the claim this one must not be collapsed into.
    expect(text()).toContain('Whether this app changed it is not recorded.');
  });

  it('names a licence it has no canonical text for, without linking one', async () => {
    const mit = [
      '[[asset]]',
      'path = "apps/mobile/android/app/src/main/res/drawable/splash.png"',
      'source = "the Capacitor Android template"',
      'licence = "MIT"',
      'read = "2026-09-16"',
      'sha256 = "cc"',
      'creator = "Ionic"',
      'url = "https://github.com/ionic-team/capacitor"',
      'modified = "no"',
    ].join('\n');
    await render(mit);
    expect(text()).toContain('MIT');
    expect(hrefs()).toContain('https://github.com/ionic-team/capacitor');
  });

  it('says so when nothing at all came from outside this project', async () => {
    const onlyOurs = [
      '[[asset]]',
      'path = "packages/fit/fixtures/corpus/header-only.fit"',
      'source = "This repository, #107"',
      'licence = "Apache-2.0"',
      'read = "2026-09-16"',
      'sha256 = "dd"',
    ].join('\n');
    await render(onlyOurs);
    expect(text()).toContain('Nothing else in this build');
  });
});

describe('the manifest ships with the build', () => {
  beforeEach(() => {
    const refuse = (name: string) => {
      return (): never => {
        throw new Error(`the credits screen must not reach the network — it called ${name}`);
      };
    };
    // Replaced by throwers rather than recorders, for `plan-no-network.test.tsx`'s
    // reason: a count is zero both when nothing was requested and when the
    // request went somewhere the recorder cannot see.
    vi.stubGlobal('fetch', refuse('fetch'));
    vi.stubGlobal('XMLHttpRequest', refuse('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', refuse('WebSocket'));
    vi.stubGlobal('EventSource', refuse('EventSource'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the real credits with every network primitive refusing', async () => {
    // #358's second criterion. A screen that fetched the manifest would also
    // be a screen that shows nothing inside the Android shell's file:// origin.
    await render();
    expect(text()).toContain('Kenney');
  });
});
