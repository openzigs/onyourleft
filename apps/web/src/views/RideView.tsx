// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { ChartSlot } from '../design/ChartSlot';
import { StatusMessage } from '../design/StatusMessage';
import { hrefFor, routeById } from '../shell/routes';

/**
 * The ride screen, as far as the shell goes.
 *
 * The recorder itself already exists —
 * [#46](https://github.com/openzigs/onyourleft/issues/46) built it in
 * `src/recording/` and this view deliberately does not re-wrap it.
 * [#49](https://github.com/openzigs/onyourleft/issues/49) is the screen that
 * drives it, and is explicitly not part of #48.
 *
 * So what is here is the frame and an honest empty state: what this page will
 * do, where to go first, and a live-channel table with no rows rather than a
 * chart that is not written. The table is `ChartSlot`'s base case, not a
 * placeholder — see that file.
 */
export function RideView(): JSX.Element {
  return (
    <>
      <StatusMessage tone="info" label="Nothing recording">
        No ride is in progress. Pair a sensor first — a ride with no sensors would record nothing
        but elapsed time.
      </StatusMessage>
      <p>
        <a href={hrefFor(routeById('devices'))}>Set up devices</a>
      </p>
      <ChartSlot
        caption="Live channels"
        columns={['Channel', 'Latest reading']}
        rows={[]}
        emptyMessage="Readings appear here once a sensor is connected and a ride has started."
      />
    </>
  );
}
