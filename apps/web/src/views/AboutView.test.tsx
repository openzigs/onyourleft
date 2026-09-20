// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The privacy policy link, which is a Google Play requirement rather than a
 * nicety ([#95](https://github.com/openzigs/onyourleft/issues/95)).
 *
 * Play's Health Content and Services policy puts this app in scope — heart rate
 * and power advance gameplay, which is Play's own example — and an app in scope
 * must carry the policy link inside the app as well as in the listing, at the
 * same URL. The failure this file exists to catch is the quiet one: somebody
 * edits the `href` in the JSX, the page still renders a link that still looks
 * like a privacy policy, and it no longer matches what the listing points at.
 *
 * Since [#404](https://github.com/openzigs/onyourleft/issues/404) it also pins
 * **what this page claims about the network**, which is a different kind of
 * assertion from everything else here: not that an element is present, but that
 * a sentence a rider reads is true of the artefact they are reading it in.
 *
 * ⚠️ **The strings below are duplicated from the JSX on purpose, and importing
 * them from a shared constant would make this file vacuous.** A test that
 * renders a constant and then asserts the constant appears cannot tell a true
 * sentence from a false one — the old wording would have passed it unchanged.
 * Pinning the literal text is what makes editing the claim a decision somebody
 * has to take twice, in two files, rather than a one-line drift.
 *
 * ⚠️ **`routes.a11y.test.tsx` already renders this page on every run and is not
 * this.** It audits the markup's structure; it reads none of the words. A page
 * can be perfectly accessible and say something false.
 */

import { describe, expect, it } from 'vitest';

import { PRIVACY_POLICY_URL, SOURCE_CODE_URL } from '../privacy/policy';
import { hrefFor, routeById } from '../shell/routes';
import { mount, queryAll } from '../testing/mount';

import { AboutView } from './AboutView';

describe('the About page', () => {
  it('links to the published privacy policy, at the one URL the listing uses', async () => {
    const mounted = await mount(<AboutView />);
    const links = queryAll<HTMLAnchorElement>(mounted.container, 'a');
    const policy = links.filter((link) => link.getAttribute('href') === PRIVACY_POLICY_URL);
    expect(policy, `no link to ${PRIVACY_POLICY_URL}`).toHaveLength(1);
    mounted.unmount();
  });

  it('gives that link text a person can act on, and says it leaves the app', async () => {
    const mounted = await mount(<AboutView />);
    const policy = queryAll<HTMLAnchorElement>(mounted.container, 'a').find(
      (link) => link.getAttribute('href') === PRIVACY_POLICY_URL,
    );
    expect(policy?.textContent ?? '').toMatch(/privacy policy/i);
    // Opening in a new tab is what hands the URL to the system browser inside
    // the Android WebView rather than navigating the app away from itself; the
    // warning beside it is visible text, because a sighted mouse user is the
    // one who otherwise gets no notice at all.
    expect(policy?.getAttribute('target')).toBe('_blank');
    expect(policy?.getAttribute('rel') ?? '').toContain('noreferrer');
    expect(mounted.container.textContent ?? '').toContain('opens in a new tab');
    mounted.unmount();
  });

  // ADR 0025 D-7. AGPL-3.0 section 6 obliges whoever conveys object code to say
  // where the source is, and the app-store additional permission in COPYRIGHT is
  // conditional on exactly that. Until ADR 0025 this screen named the licence
  // and never said where the source was — which a store user cannot guess.
  it('says where the source code is — the condition a store build ships under', async () => {
    const mounted = await mount(<AboutView />);
    const source = queryAll<HTMLAnchorElement>(mounted.container, 'a').filter(
      (link) => link.getAttribute('href') === SOURCE_CODE_URL,
    );
    expect(source, `no link to ${SOURCE_CODE_URL}`).toHaveLength(1);
    expect(source[0]?.textContent ?? '').toMatch(/source code/i);
    expect(source[0]?.getAttribute('target')).toBe('_blank');
    expect(source[0]?.getAttribute('rel') ?? '').toContain('noreferrer');
    mounted.unmount();
  });

  it('points the source link at the repository itself, not at a page inside it', () => {
    // The privacy policy's URL is derived from the same constant, so a test
    // that only compared the link against the export would pass if both were
    // wrong together. This one states the address.
    expect(SOURCE_CODE_URL).toBe('https://github.com/openzigs/onyourleft');
    expect(PRIVACY_POLICY_URL.startsWith(`${SOURCE_CODE_URL}/`)).toBe(true);
  });

  it('reaches the credits, which is where an attribution obligation is discharged', async () => {
    // ⚠️ **The same shape as the privacy link above, and for a stricter
    // reason.** ADR 0023 D-3 puts the asset attribution inside the app because
    // CC BY 4.0 §3(a)(2) judges "a reasonable manner" by the medium, and the
    // medium is an APK whose user never sees this repository. The credits page
    // is deliberately not in the header navigation, so this link is the only
    // way to it: delete it and the page is unreachable, the notice is
    // undiscoverable, and nothing else in the suite would notice.
    const mounted = await mount(<AboutView />);
    const credits = queryAll<HTMLAnchorElement>(mounted.container, 'a').filter(
      (link) => link.getAttribute('href') === hrefFor(routeById('credits')),
    );
    expect(credits, 'the About page does not link to the credits').toHaveLength(1);
    expect(credits[0]?.textContent ?? '').toMatch(/credits/i);
    mounted.unmount();
  });
});

describe('what the About page claims about the network — #404, then #408', () => {
  /**
   * ⚠️ **This block used to forbid the strong claim and now requires it.**
   *
   * #404 measured the shipped build failing offline and replaced *"the app
   * works with no network at all"* with *"your data is local; the app is
   * not"*, and this suite pinned the retreat. #408 built the gate that makes
   * the strong claim checkable — `apps/web/browser/offline.browser.spec.ts`,
   * in the pinned Chromium, with `setOffline(true)`, in a reopened browsing
   * context, and with a control that must fail in the same run — so the page
   * says it again.
   *
   * ⚠️ The rule #404 wrote is unchanged and is what makes this legitimate: the
   * gate landed **first**, in the same pull request. A future edit that
   * strengthens this copy further needs the same order.
   */
  const DATA_IS_LOCAL = 'they leave this device only when you export them';
  const FIRST_VISIT_NEEDS_A_CONNECTION = 'The first visit needs a connection';
  const AFTERWARDS_IT_WORKS_OFFLINE = 'with the network off works';
  const THE_MAP_IS_THE_EXCEPTION = 'background imagery';

  async function aboutText(): Promise<string> {
    const mounted = await mount(<AboutView />);
    const text = mounted.container.textContent ?? '';
    mounted.unmount();
    return text;
  }

  it('says the app keeps its own copy and opens with the network off', async () => {
    const text = await aboutText();
    expect(text).toContain(AFTERWARDS_IT_WORKS_OFFLINE);
  });

  it('says the first visit still needs a connection, which is the honest limit', async () => {
    // The positive claim above is true only after a first load. A page that
    // said "works offline" flat would be the #404 sentence again with better
    // machinery behind it.
    const text = await aboutText();
    expect(text).toContain(FIRST_VISIT_NEEDS_A_CONNECTION);
  });

  it('names the map as the one thing that is not offline — ADR 0024 D-2', async () => {
    // The basemap is a ~19 GB archive on object storage and is deliberately not
    // precached. A rider in a basement gets the trainer game and not the map,
    // and being told that is the difference between a limit and a bug report.
    const text = await aboutText();
    expect(text).toContain(THE_MAP_IS_THE_EXCEPTION);
  });

  it('still makes the claim that was always true: the data is local', async () => {
    // #404's second criterion, unchanged. "Your rides are on this device" is
    // the whole point of ADR 0002 and must not be lost to a rewrite of the
    // sentence beside it.
    const text = await aboutText();
    expect(text).toContain(DATA_IS_LOCAL);
    expect(text).toContain('nothing is uploaded');
  });
});
