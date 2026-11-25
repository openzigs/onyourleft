// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the game screen knows of an open-world ride** — #2896.
 *
 * The game reads a ride as a {@link RidableRoute}, and an open-world ride
 * reaches it as one: the rolling route's first view (`session.ts`), offered
 * as a card on the picker under {@link OPEN_WORLD_ROUTE_ID}. This module is the
 * shape of that hand-over and nothing heavier, so the game screen names it
 * without taking the map reader, the street graph or the rolling route into
 * its chunk: those are `session.ts`', loaded by `session-lazy.ts` when a start
 * is waiting.
 *
 * ⚠️ **A refusal names the constraint and never the value** (ADR 0004 D, ADR
 * 0090 R-2): {@link describeOpenWorldRefusal} is the only place one becomes
 * words, and the one number in any of them is
 * {@link OPEN_WORLD_START_REACH_METRES}, the stated distance — never the
 * start's position, a tile or a block. `session.test.ts` holds it.
 */

import type { UnitSystem } from '@onyourleft/store';

import { formatSmallDistance, measurementText } from '../../units/format';
import type { RidableRoute } from '../StageChooser';
import type { OpenWorldRoad } from './road';
import type { OpenWorldStart } from './start';

export { OPEN_WORLD_ROUTE_ID, isOpenWorldRouteId } from './route-id';

/**
 * How far from its start an open-world ride looks for a street to begin on:
 * **200 m**. *#2896's choice*: well past the pin's 55 m nudge
 * (`start.ts` §`PIN_NUDGE_DEGREES`), so a pin dropped on a building or a
 * park beside a street still starts on it, and short of a block's width, so
 * a pin in the middle of a field is refused rather than ridden from a road
 * the rider did not mean.
 */
export const OPEN_WORLD_START_REACH_METRES = 200;

/** Why an open-world ride could not begin. */
export type OpenWorldRefusal =
  /** No street the graph allows lies within {@link OPEN_WORLD_START_REACH_METRES} of the start. */
  | 'no-street'
  /** Map tiles are off in Settings (ADR 0090 D-7.1): nothing was asked for. */
  | 'map-tiles-off'
  /** This build names no map archive. */
  | 'no-map'
  /** The archive is not the Protomaps basemap v4 schema. */
  | 'wrong-schema'
  /** The start's block could not be read, or not in time. */
  | 'unavailable';

/** What a session's start came to. */
export type OpenWorldReady =
  /**
   * The ride may begin: its first view, as the picker's card, and the road
   * each ride on it follows past that view (#2982): a new one each call, from
   * the snapped start, so a second ride on the card starts where the first did.
   */
  | { readonly kind: 'ready'; readonly route: RidableRoute; readonly road: () => OpenWorldRoad }
  | { readonly kind: 'refused'; readonly refusal: OpenWorldRefusal }
  /** {@link OpenWorldSession.stop} was called first. */
  | { readonly kind: 'stopped' };

/** One open-world ride, from its start to the end of the ride or the screen. */
export interface OpenWorldSession {
  /** Its start: the first blocks read, the graph built and the start snapped. Never rejects. */
  readonly ready: Promise<OpenWorldReady>;
  /**
   * The ride ended or the screen was left: the running read is abandoned,
   * nothing more is asked for and no timer is left. Safe to call twice.
   */
  stop(): void;
}

/** What the game port carries for open-world rides — `main.tsx` builds it. */
export interface OpenWorldSessions {
  /** The start the picker handed over (`entry.ts`), once; `undefined` when none waits. */
  take(): OpenWorldStart | undefined;
  /** A session on `start`. Its first blocks are asked for at once. */
  open(start: OpenWorldStart, extras?: OpenWorldSessionExtras): OpenWorldSession;
}

/** What a screen may ask of a session beyond its start. */
export interface OpenWorldSessionExtras {
  /**
   * #3154: the name a street is shown by, in place of the map's — on the road
   * and in the junction prompt alike — or `undefined` to show none. Capture
   * mode's alone (`capture-free-ride.ts` §`captureStreetName`): no real street
   * or place name is on a capture's screen. Absent, the map's own.
   */
  readonly streetName?: ((name: string) => string | undefined) | undefined;
}

/**
 * A refusal in words: what stopped the ride and what to do, and never a
 * coordinate, a tile or a block (ADR 0004 D). The reach is in the rider's
 * units (#238).
 */
export function describeOpenWorldRefusal(refusal: OpenWorldRefusal, units: UnitSystem): string {
  switch (refusal) {
    case 'no-street': {
      const reach = measurementText(formatSmallDistance(OPEN_WORLD_START_REACH_METRES, units));
      return `There is no street a bike can ride within ${reach} of that start, so the open-world ride cannot begin there. Choose a start on a street or nearer one.`;
    }
    case 'map-tiles-off':
      return 'Map tiles are off in Settings, so an open-world ride has no streets to follow. Turn on map tiles in Settings → Ride map to ride one.';
    case 'no-map':
      return 'This copy of the app has no map to read, so it cannot start an open-world ride.';
    case 'wrong-schema':
      return 'The map this app reads is not one it understands, so an open-world ride cannot start.';
    case 'unavailable':
      return 'The map round that start could not be read. Check the connection and choose the start again.';
  }
}
