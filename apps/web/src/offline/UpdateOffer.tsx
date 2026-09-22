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

import type { UpdateStatus, UpdateWatcher } from './update';

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

/**
 * A tab another tab left behind — #483, ADR 0027 D-1.
 *
 * ⚠️ **It says what is wrong with THIS tab, not that an update is available.**
 * The update already happened somewhere else; this page is the one thing that
 * did not move. So the copy names the symptom a rider would otherwise meet as a
 * mystery — a screen that will not open — and, like every other line here,
 * makes exactly one claim about data and it is a claim about what is not
 * touched.
 */
export const UPDATE_SUPERSEDED_TEXT =
  'A newer version of On Your Left started in another tab, and this one is still running the ' +
  'older version. Parts of it may fail to open until you reload. Reloading does not affect your ' +
  'recorded rides.';

export const UPDATE_SUPERSEDED_DEFERRED_TEXT =
  'A newer version of On Your Left started in another tab, and this one is still running the ' +
  'older version. It will not be reloaded while a ride is in progress — finish and save your ' +
  'ride, and you can reload then.';

/**
 * One sentence per state the rider can be in.
 *
 * A record rather than a chain of ternaries: with six states the chain reads as
 * a default, and a state added to {@link UpdateStatus} without a sentence would
 * fall into whichever branch happened to be last. Here it is a type error.
 */
const TEXT_FOR: Readonly<Record<Exclude<UpdateStatus, 'none'>, string>> = {
  available: UPDATE_AVAILABLE_TEXT,
  deferred: UPDATE_DEFERRED_TEXT,
  activating: UPDATE_ACTIVATING_TEXT,
  superseded: UPDATE_SUPERSEDED_TEXT,
  'superseded-deferred': UPDATE_SUPERSEDED_DEFERRED_TEXT,
};

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
        {TEXT_FOR[status]}
      </StatusMessage>
      {status === 'available' ? (
        <p className="oyl-update__actions">
          <Button onClick={watcher.activate}>Update now</Button>{' '}
          <Button variant="secondary" onClick={watcher.dismiss}>
            Not now
          </Button>
        </p>
      ) : null}
      {/*
        ⚠️ **No "Not now" beside it, unlike the offer above.** Dismissing an
        offer leaves a rider on a version that works; dismissing this would
        leave them on a version whose next lazy route may not open, with nothing
        left on screen to say why. ADR 0027 D-2.
      */}
      {status === 'superseded' ? (
        <p className="oyl-update__actions">
          <Button onClick={watcher.reloadNow}>Reload now</Button>
        </p>
      ) : null}
    </section>
  );
}
