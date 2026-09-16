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
        uploaded — rides are recorded, stored and read back locally. That is a deliberate choice
        rather than a missing feature, and it is why the app works with no network at all.
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
    </>
  );
}
