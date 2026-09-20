// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider is told when a new version of the app is waiting (#407).
 *
 * ## The copy, and the one thing it must not say
 *
 * #407's last criterion: *"the offer's text does not promise anything about the
 * rider's data — an update replaces the app, never the rides."* So the copy
 * makes exactly one claim about data, and it is a claim about what an update
 * **does not touch**: the rides are in this browser's own storage and an update
 * replaces the application around them. It promises nothing about backups,
 * nothing about durability, and nothing about what clearing site data would do
 * — `AboutView` owns those and is honest about them.
 *
 * ## Why the deferred state renders no button
 *
 * A control that cannot act is worse than no control (#48's first criterion,
 * and `design/Button.tsx`'s own note about `disabled`): a disabled button is
 * out of the tab order, so a keyboard rider reaches it never and hears why
 * never. While a ride is in progress the offer is a **sentence**, and the
 * buttons come back when the ride is saved — which is a state change the
 * watcher announces, so nothing polls.
 */

import { useSyncExternalStore, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

import type { UpdateWatcher } from './update';

/**
 * The offer's accessible name.
 *
 * A `<section>` is only a landmark when it has one, and an unnamed landmark is
 * a region a screen-reader user lands in with no idea what it is.
 */
export const UPDATE_REGION_LABEL = 'App update';

/** Written down so the test can assert the honest half cannot be deleted alone. */
export const UPDATE_AVAILABLE_TEXT =
  'A new version of On Your Left is ready. Updating replaces the app and reloads this page; ' +
  'your recorded rides are not affected.';

export const UPDATE_DEFERRED_TEXT =
  'A new version of On Your Left is ready. It will not be applied while a ride is in progress — ' +
  'finish and save your ride, and it will be offered then.';

export const UPDATE_ACTIVATING_TEXT = 'Updating. This page will reload in a moment.';

export interface UpdateOfferProps {
  readonly watcher: UpdateWatcher;
}

export function UpdateOffer({ watcher }: UpdateOfferProps): JSX.Element | null {
  const status = useSyncExternalStore(watcher.subscribe, watcher.status, watcher.status);

  if (status === 'none') {
    return null;
  }

  return (
    <section className="oyl-update" aria-label={UPDATE_REGION_LABEL}>
      {/*
        `live` so a rider who is reading a page when the update arrives is told
        rather than having to notice. It appears in response to something that
        happened rather than at load, which is the case `StatusMessage`'s note
        says a live region is for.
      */}
      <StatusMessage tone="info" label="Update" live>
        {status === 'available'
          ? UPDATE_AVAILABLE_TEXT
          : status === 'deferred'
            ? UPDATE_DEFERRED_TEXT
            : UPDATE_ACTIVATING_TEXT}
      </StatusMessage>
      {status === 'available' ? (
        <p className="oyl-update__actions">
          <Button onClick={watcher.activate}>Update now</Button>{' '}
          <Button variant="secondary" onClick={watcher.dismiss}>
            Not now
          </Button>
        </p>
      ) : null}
    </section>
  );
}
