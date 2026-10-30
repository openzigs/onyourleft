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

import { describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRIVACY_POLICY_URL, SOURCE_CODE_URL } from '../privacy/policy';
import { MAX_DATA_LOSS_SECONDS } from '../recording/recorder';
import { hrefFor, routeById } from '../shell/routes';
import { scriptedInstance } from '../instance/testing';
import { mount, queryAll, settle } from '../testing/mount';

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
    // #664: the same link is the way to the third-party software notices, and
    // the sentence around it says so — a rider looking for a licence notice
    // has no other reason to open a page called Credits.
    expect(credits[0]?.closest('p')?.textContent ?? '').toMatch(
      /software.*every software licence notice in full/s,
    );
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

  it('names the one thing the app can send, and to whose computer — #387', async () => {
    // The About page is the in-app half of the privacy policy. It said
    // "Nothing is collected" until #387 gave the client one network call, and
    // a page that went on saying so would be false for any rider who set up
    // their own computer.
    const text = await aboutText();
    expect(text).toContain('Nothing is sent to us');
    expect(text).toContain('a computer of your own');
    expect(text).not.toContain('Nothing is collected');
  });

  it('names what an instance is sent, and only on connecting — #777, #778', async () => {
    // "No server to sign in to" became false the day a rider could connect to
    // an instance, so the page says when it is true and what the one
    // exception sends.
    const text = await aboutText();
    expect(text).toContain('unless you choose to connect to an instance');
    expect(text).toContain('Nothing is sent to us unless you connect to this project’s instance');
    expect(text).toContain('public key, the name other riders will see if you type one');
    // #892's review: the browser sends its own headers too, so "nothing else"
    // alone was not true. What the code guarantees is nothing else OF YOURS.
    expect(text).toContain('your internet address and device or browser type');
    expect(text).toContain('nothing else of yours when you connect: no ride, route, position');
    expect(text).not.toContain('from this version of the app, nothing else');
    expect(text).not.toContain('There is no account, no analytics and no server');
    const mounted = await mount(<AboutView />);
    const link = mounted.container.querySelector('a[href="#/settings/instance"]');
    mounted.unmount();
    expect(link?.textContent).toBe('connect to an instance');
  });

  it('names what a private room and a sync send, both of which it offers — #778, #1195, #1327', async () => {
    // Rooms shipped (#784, #785) and so did sync (#1195): the page says what a
    // room and a sync send, so that a rider is surprised by neither.
    const text = (await aboutText()).replace(/\s+/g, ' ');
    expect(text).toContain('the route of a room you make, your power and cadence while you ride');
    expect(text).toContain('the weight you declare as you join, and a race’s result');
    // #1327: sync has been offered since #1195, so the page must not say it is not.
    expect(text).not.toContain('does not offer yet');
    expect(text).toContain('Syncing with it sends your rides, whole');
    expect(text).toContain('your rides, whole, with their positions and heart rate');
    expect(text).toContain('sealed on this device for that instance alone');
    expect(text).toContain('or sync them with an instance you connected to');
    // #1215's review: the claims above are about the app as a whole, so they
    // must not say a room's route or a sync's rides are never sent.
    expect(text).not.toContain('transmits your rides, your heart rate or your position anywhere');
    expect(text).toContain('a ride’s name and date go with it');
  });
});

describe('what the About page says about a ride the app closed on — #411', () => {
  /**
   * The same discipline as the block above: the sentences are pinned as
   * literals, because a test that rendered a shared constant could not tell a
   * true sentence from a false one. The NUMBER is the exception, and it is
   * the point of #411's second criterion — it is derived from the recorder's
   * own constant in the view, and this file then checks the README says the
   * same number, so the three places it is written agree or the build is red.
   */
  const README = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'README.md');
  const WORDS: Record<string, number> = {
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };

  async function aboutText(): Promise<string> {
    const mounted = await mount(<AboutView />);
    const text = mounted.container.textContent ?? '';
    mounted.unmount();
    return text;
  }

  it('says a ride is written as it happens, and survives the tab closing', async () => {
    const text = await aboutText();
    expect(text).toContain('A ride is written to this device’s storage as it happens');
    expect(text).toContain('what was recorded up to then is still here');
  });

  it('states the bound, and it is the recorder’s own number', async () => {
    const text = await aboutText();
    expect(text).toContain(
      `At most ${String(MAX_DATA_LOSS_SECONDS)} seconds of a ride can be lost to a crash`,
    );
    // The literal, too: moving the recorder's cadence is a decision this
    // sentence has to be read against, not a number that slides silently.
    expect(text).toContain('At most 8 seconds of a ride can be lost to a crash');
  });

  it('agrees with the README, which states the same bound in words', () => {
    const readme = readFileSync(README, 'utf8');
    const stated = /At most (\w+) seconds of a ride can be lost to a crash/.exec(readme)?.[1];
    expect(stated, 'README.md no longer states the bound in the sentence this reads').toBeDefined();
    expect(WORDS[stated ?? '']).toBe(MAX_DATA_LOSS_SECONDS);
  });

  it('keeps the “up to”, which the recovery read insists on', async () => {
    const text = await aboutText();
    expect(text).toContain('offered as up to a length');
    expect(text).toContain('to its last checkpoint');
  });

  it('says a finished ride is offered save and discard but not continue, and why', async () => {
    const text = await aboutText();
    expect(text).toContain('offered save and discard but not continue');
    expect(text).toContain('whose save failed, and you ended it on purpose');
  });

  it('claims nothing it cannot support', async () => {
    const text = (await aboutText()).toLowerCase();
    expect(text).not.toContain('cannot be lost');
    expect(text).not.toContain('backup');
    expect(text).not.toContain('cloud');
  });
});

describe('where the rides are, per platform and per instance — #1450', () => {
  /**
   * It said "clearing this browser's site data removes your rides, and there
   * is no copy anywhere else to restore from" in the Android app too, and with
   * an instance that keeps a synced ride. It is now History's sentence
   * (`where-rides-are.ts`), pinned here as literals by the same discipline as
   * the blocks above.
   */
  const BROWSER_ALONE =
    'Rides are stored on this device. Clearing this browser’s site data ' +
    'deletes them from this device — export anything you want to keep.';
  const BROWSER_WITH_INSTANCE =
    'Rides are stored on this device, and a ride you sync is also kept on your instance. ' +
    'Clearing this browser’s site data deletes them from this device — export anything you ' +
    'want to keep.';
  const APP_ALONE =
    'Rides are stored on this device. Uninstalling the app, or clearing its storage in ' +
    'Android’s settings, deletes them from this device — export anything you want to keep.';
  const APP_WITH_INSTANCE =
    'Rides are stored on this device, and a ride you sync is also kept on your instance. ' +
    'Uninstalling the app, or clearing its storage in Android’s settings, deletes them from ' +
    'this device — export anything you want to keep.';

  async function said(
    nativeShell: boolean,
    instance?: ReturnType<typeof scriptedInstance>,
  ): Promise<{ readonly sentence: string; readonly page: string }> {
    const mounted = await mount(<AboutView nativeShell={nativeShell} instance={instance?.port} />);
    await settle();
    const sentences = queryAll(mounted.container, 'p')
      .map((p) => p.textContent ?? '')
      .filter((text) => text.startsWith('Rides are stored on this device'));
    const page = (mounted.container.textContent ?? '').replace(/\s+/g, ' ');
    mounted.unmount();
    expect(sentences).toHaveLength(1);
    return { sentence: sentences[0]!, page };
  }

  const CASES = [
    {
      name: 'a browser with no instance',
      native: false,
      connected: undefined,
      want: BROWSER_ALONE,
    },
    { name: 'a browser, not connected', native: false, connected: false, want: BROWSER_ALONE },
    { name: 'a browser, connected', native: false, connected: true, want: BROWSER_WITH_INSTANCE },
    { name: 'the app with no instance', native: true, connected: undefined, want: APP_ALONE },
    { name: 'the app, not connected', native: true, connected: false, want: APP_ALONE },
    { name: 'the app, connected', native: true, connected: true, want: APP_WITH_INSTANCE },
  ] as const;

  for (const { name, native, connected, want } of CASES) {
    it(`in ${name}`, async () => {
      const instance = connected === undefined ? undefined : scriptedInstance({ connected });
      const { sentence, page } = await said(native, instance);
      expect(sentence).toBe(want);
      expect(page).not.toContain('anywhere else');
      expect(page).not.toContain('nowhere else');
      if (native) expect(sentence).not.toContain('browser');
    });
  }

  it('counts a signed-out instance as one: the rides synced before are still there', async () => {
    const instance = scriptedInstance({
      connected: true,
      state: { kind: 'signed-out', origin: 'https://ride.example' },
    });
    expect((await said(false, instance)).sentence).toBe(BROWSER_WITH_INSTANCE);
  });
});

/**
 * Which copy of the app this is — #1745. A Play install and a direct-download
 * install cannot update each other, and switching means an uninstall that
 * deletes the rides on the device, so the Android app says which one it is.
 * The sentences are literals here for the reason at the top of this file.
 */
describe('the About page names the channel the Android app came from', () => {
  const HEADING = 'Which copy of the app this is';
  const SWITCHING =
    'Moving from one to the other means uninstalling this app first, and uninstalling deletes ' +
    'the rides on this device — export them, or sync them with an instance, before you switch.';
  const PLAY =
    'This copy was installed from Google Play. The app is also offered as a direct download, an ' +
    'APK file from its releases on GitHub, and the two cannot update each other, because each is ' +
    `signed with a different key. ${SWITCHING}`;
  const DIRECT =
    'This copy is the direct download: an APK file, installed from outside Google Play. The copy ' +
    'on Google Play and this one cannot update each other, because each is signed with a ' +
    `different key. ${SWITCHING}`;
  const NOT_RELEASED =
    'This copy was not built by a release, so it is neither the Google Play copy nor the direct ' +
    'download, and neither of those can update it. Moving to one of them means uninstalling this ' +
    'app first, and uninstalling deletes the rides on this device — export them, or sync them ' +
    'with an instance, before you switch.';

  async function section(props: Parameters<typeof AboutView>[0]): Promise<string | undefined> {
    const mounted = await mount(<AboutView {...props} />);
    const heading = queryAll(mounted.container, 'h2').find((h) => h.textContent === HEADING);
    const text = heading?.parentElement?.querySelector('p')?.textContent ?? undefined;
    mounted.unmount();
    return text;
  }

  it('says Google Play in a Play build', async () => {
    expect(await section({ nativeShell: true, releaseChannel: 'play' })).toBe(PLAY);
  });

  it('says the direct download in an APK build', async () => {
    expect(await section({ nativeShell: true, releaseChannel: 'direct' })).toBe(DIRECT);
  });

  it('claims neither channel in an app no release built', async () => {
    vi.stubEnv('VITE_OYL_RELEASE_CHANNEL', '');
    try {
      expect(await section({ nativeShell: true, releaseChannel: undefined })).toBe(NOT_RELEASED);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reads the channel from the build when nothing is passed', async () => {
    vi.stubEnv('VITE_OYL_RELEASE_CHANNEL', 'play');
    try {
      expect(await section({ nativeShell: true })).toBe(PLAY);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is not shown in a browser, which has neither channel', async () => {
    expect(await section({ nativeShell: false, releaseChannel: 'play' })).toBeUndefined();
  });
});
