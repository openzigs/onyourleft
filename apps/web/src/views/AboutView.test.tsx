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
 */

import { describe, expect, it } from 'vitest';

import { PRIVACY_POLICY_URL } from '../privacy/policy';
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
});
