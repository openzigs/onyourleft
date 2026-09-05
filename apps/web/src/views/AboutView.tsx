// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { hrefFor, routeById } from '../shell/routes';

/**
 * What this is and what it is not, in one place a link can point at.
 *
 * The browser limitation is explained on the Devices page, where an athlete
 * meets it. This page carries the two things that are true everywhere: there is
 * no account and no server, and the data is on this device only.
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

      <h2>Licence</h2>
      <p>
        Free and open source. This client is licensed under the GNU Affero General Public License,
        version 3 or later; the packages it is built from are Apache-2.0.
      </p>
    </>
  );
}
