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

import { PRIVACY_POLICY_URL } from '../privacy/policy';
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

describe('what the About page claims about the network — #404', () => {
  /**
   * The wording measured on 2026-09-19 and shipped by #404, quoted here rather
   * than imported. Two halves, and the issue's acceptance criteria require
   * both: a page that dropped the paragraph entirely would satisfy the
   * correction and lose the claim that is actually true.
   */
  const DATA_IS_LOCAL = 'they leave this device only when you export them';
  const APP_NEEDS_THE_NETWORK_TO_START = 'it needs a connection to start';

  /**
   * The family the retracted sentence belongs to, not the sentence alone.
   *
   * ⚠️ Matching only the literal `works with no network at all` would be
   * defeated by re-typing it as "works without a network" or "no network is
   * needed", which is the same false claim. The pattern is deliberately loose
   * and the replacement wording was written to stay clear of it.
   */
  const CLAIMS_NO_NETWORK_IS_NEEDED =
    /(?:work|run|start|open|load)s?[^.]{0,40}(?:with no network|without a network|no network at all)/i;

  async function aboutText(): Promise<string> {
    const mounted = await mount(<AboutView />);
    const text = mounted.container.textContent ?? '';
    mounted.unmount();
    return text;
  }

  it('does not claim the app works with no network, because it does not', async () => {
    // Measured 2026-09-19 against `vite preview` over `apps/web/dist`, in this
    // repository's own pinned Chromium: an offline reload of a loaded tab and
    // an offline cold start in a fresh context both return
    // `net::ERR_INTERNET_DISCONNECTED` and a blank page. No service worker, no
    // Cache Storage, no web app manifest. #402 is the epic that changes that;
    // #408 re-states the claim once a gate can prove it.
    const text = await aboutText();
    expect(
      text,
      'the About page claims the app needs no network, which the shipped browser build does not honour (#404)',
    ).not.toMatch(CLAIMS_NO_NETWORK_IS_NEEDED);
  });

  it('says instead that a cold start needs a connection', async () => {
    // The negative above passes against a page with the paragraph deleted, and
    // against a page that says nothing at all. This is the half that does not.
    const text = await aboutText();
    expect(text).toContain(APP_NEEDS_THE_NETWORK_TO_START);
  });

  it('still makes the claim that IS true: the data is local and leaves only on export', async () => {
    // #404's second criterion. The correction must not be taken by deleting the
    // paragraph — "your rides are on this device" is the whole point of ADR
    // 0002 and it is true, unlike the sentence that used to sit beside it.
    const text = await aboutText();
    expect(text).toContain(DATA_IS_LOCAL);
    expect(text).toContain('nothing is uploaded');
  });
});
