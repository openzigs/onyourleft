// SPDX-License-Identifier: AGPL-3.0-or-later

import { metresPerSecond } from '@onyourleft/domain';
import type { JSX } from 'react';

import { formatSpeed } from './format';

/**
 * Scaffold shell for the browser client. #48-#51 build the real thing on top of
 * it; what it proves today is that the workspace is wired end to end — an
 * `apps/` module rendering a value produced by an Apache-2.0 `packages/` module,
 * through the same import path a real screen will use.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>On Your Left</h1>
      <p>
        Ride tracking, indoor trainer control and live sensor capture over Bluetooth Low Energy.
        Entirely local — no server, no account.
      </p>
      <p>Example speed: {formatSpeed(metresPerSecond(10))}</p>
    </main>
  );
}
