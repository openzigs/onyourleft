// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { ChartSlot } from '../design/ChartSlot';
import { hrefFor, routeById } from '../shell/routes';

/**
 * The ride history, empty until there is one.
 *
 * Reading the stored activities is
 * [#50](https://github.com/openzigs/onyourleft/issues/50)'s. What the shell
 * owes is that the empty state is a real page — heading, explanation, a way
 * onward — rather than a blank panel that reads as a loading failure.
 */
export function ActivitiesView(): JSX.Element {
  return (
    <>
      <ChartSlot
        caption="Rides on this device"
        columns={['Ride', 'Started', 'Distance']}
        rows={[]}
        emptyMessage="Nothing recorded yet. A ride appears here the moment you finish one."
      />
      <p className="oyl-muted">
        Rides are stored on this device and nowhere else. There is no account and no server, so
        clearing this browser&rsquo;s site data deletes them — export anything you want to keep.
      </p>
      <p>
        <a href={hrefFor(routeById('ride'))}>Start a ride</a>
      </p>
    </>
  );
}
