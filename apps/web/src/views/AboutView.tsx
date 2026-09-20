// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { PRIVACY_POLICY_URL, SOURCE_CODE_URL } from '../privacy/policy';
import { hrefFor, routeById } from '../shell/routes';

/**
 * What this is and what it is not, in one place a link can point at.
 *
 * The browser limitation is explained on the Devices page, where an athlete
 * meets it. This page carries the two things that are true everywhere: there is
 * no account and no server, and the data is on this device only.
 *
 * ⚠️ **This page has now said three different things about the network, and a
 * reviewer who remembers either of the first two is reading an old file.**
 *
 * 1. It said *"it is why the app works with no network at all"*. That was
 *    **false of the shipped browser build**, measured on 2026-09-19 in this
 *    repository's own pinned Chromium: an offline reload of a loaded tab and an
 *    offline cold start in a fresh context both returned
 *    `net::ERR_INTERNET_DISCONNECTED` and a blank page, because there was no
 *    service worker, no Cache Storage entry and no web app manifest
 *    ([#404](https://github.com/openzigs/onyourleft/issues/404)).
 * 2. #404 replaced it with *"your data is local; the app is not"* — accurate,
 *    and a retreat.
 * 3. ⚠️ **Since #408 it says the strong thing again, and this time a gate
 *    proves it.** `apps/web/browser/offline.browser.spec.ts` loads
 *    `apps/web/dist` in the pinned Chromium with
 *    `BrowserContext.setOffline(true)`, in a browsing context that was closed
 *    and reopened, and asserts the app renders — **with a control**: a resource
 *    outside the precache must fail in the same run, and every offline response
 *    must report `fromServiceWorker`. Without those two a green run would be
 *    indistinguishable from the network never having been switched off.
 *
 * ⚠️ **What has NOT changed is the rule.** #404's header is still the one to
 * obey: *"do not re-strengthen this without a gate that proves it — restoring
 * the claim first is how it went unnoticed the first time."* This was
 * re-strengthened **after** the gate landed and in the same pull request as it,
 * and `AboutView.test.tsx` pins every half of the new wording by string,
 * including the limits: the first visit needs a connection, and the map's
 * background imagery is fetched when it is looked at (ADR 0024 D-2
 * deliberately does not precache a ~19 GB archive).
 *
 * ⚠️ **The privacy policy link is a Play requirement, not a courtesy**
 * ([#95](https://github.com/openzigs/onyourleft/issues/95)). Play's Health
 * Content and Services policy puts an app in scope when health data advances
 * gameplay, and an app in scope must carry the policy link *inside the app* as
 * well as in the listing. This page is where it lives; `privacy/policy.ts` is
 * the one place the URL is written down.
 */
export function AboutView(): JSX.Element {
  return (
    <>
      <h2>Where your data lives</h2>
      <p>
        On this device. There is no account to create, no server to sign in to and nothing is
        uploaded — rides are recorded, stored and read back locally, and they leave this device only
        when you export them yourself. That is a deliberate choice rather than a missing feature.
      </p>
      <p>
        Your data is local, and so is the app. The first visit needs a connection, because that is
        when the browser fetches it; after that it keeps its own copy, and opening it in a fresh tab
        with the network off works — recording a ride, riding the trainer game and reading your
        history all do. The exception is the map&rsquo;s background imagery, which is fetched from
        the web when you look at it.
      </p>
      <p>
        The consequence is the honest one: clearing this browser&rsquo;s site data removes your
        rides, and there is no copy anywhere else to restore from.
      </p>

      <h2>Sensors</h2>
      <p>
        Sensors connect over Bluetooth Low Energy, and only over Bluetooth Low Energy. Whether that
        works depends on the browser rather than on the sensor — the{' '}
        <a href={hrefFor(routeById('devices'))}>Devices page</a> says what yours can do and why.
      </p>

      <h2>Privacy</h2>
      <p>
        Nothing is collected. There is no account, no analytics and no server to send anything to,
        and the app contains no code that transmits your rides, your heart rate or your position
        anywhere.
      </p>
      <p>
        {/* target="_blank" so that following it inside the Android shell hands
            the URL to the system browser rather than navigating the WebView the
            app is running in. The trailing note is visible text rather than an
            aria-label, because a sighted mouse user gets no warning otherwise. */}
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
          Read the full privacy policy
        </a>{' '}
        (opens in a new tab).
      </p>

      <h2>Licence</h2>
      <p>
        Free and open source. This client is licensed under the GNU Affero General Public License,
        version 3 or later; the packages it is built from are Apache-2.0.
      </p>
      {/* ⚠️ Not a courtesy: AGPL-3.0 section 6 requires whoever conveys object
          code to say where the source is, and ADR 0025 D-7 makes this link a
          CONDITION of the permission a store build ships under. A rider who
          installed from a store has never seen the repository — the same fact
          the Credits link below rests on. `AboutView.test.tsx` pins it. */}
      <p>
        <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
          Get the source code of this app
        </a>{' '}
        (opens in a new tab). You may copy, change and share it under that licence.
      </p>
      {/* ⚠️ This link is the reachable half of an obligation, not a courtesy.
          ADR 0023 D-3 puts the attribution inside the app because CC BY 4.0
          §3(a)(2) judges "a reasonable manner" by the medium, and the medium is
          an APK whose user never sees the repository. `AboutView.test.tsx`
          asserts the link is here for that reason. */}
      <p>
        The artwork this app ships was made by other people.{' '}
        <a href={hrefFor(routeById('credits'))}>Credits</a> says who, and under what terms.
      </p>
    </>
  );
}
