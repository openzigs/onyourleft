// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { PRIVACY_POLICY_URL } from '../privacy/policy';
import { hrefFor, routeById } from '../shell/routes';

/**
 * What this is and what it is not, in one place a link can point at.
 *
 * The browser limitation is explained on the Devices page, where an athlete
 * meets it. This page carries the two things that are true everywhere: there is
 * no account and no server, and the data is on this device only.
 *
 * ⚠️ **This page used to say "it is why the app works with no network at all",
 * and a reviewer who remembers that sentence is reading the old file**
 * ([#404](https://github.com/openzigs/onyourleft/issues/404)). It was false of
 * the shipped browser build and was measured to be so on 2026-09-19, in this
 * repository's own pinned Chromium: an offline reload of a loaded tab and an
 * offline cold start in a fresh context both return
 * `net::ERR_INTERNET_DISCONNECTED` and a blank page, because there is no
 * service worker, no Cache Storage entry and no web app manifest.
 *
 * The distinction that sentence flattened is the one this page now draws, and
 * it is the useful one: **the DATA is local and the APP is not.** Nothing in
 * `apps/web/src`, and nothing in any leaf package's source tree, calls `fetch`
 * or `XMLHttpRequest` at all, so recording, storing, analysing and riding
 * genuinely need no network — but the client is still handed its HTML and its
 * bundle by a server, so a cold start needs one.
 *
 * ⚠️ **Do not re-strengthen this without a gate that proves it.** Making the
 * old sentence true is epic
 * [#402](https://github.com/openzigs/onyourleft/issues/402) and several pull
 * requests of work; restoring the claim first is how it went unnoticed the
 * first time. `AboutView.test.tsx` pins both halves of the replacement by
 * string for exactly that reason.
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
        Your data is local; the app is not. In a browser it is served over the web like any other
        page, so it needs a connection to start — opening it in a fresh tab, or reloading it, will
        not work with the network off. Once it has loaded, recording a ride does not need one.
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
