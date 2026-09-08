// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a *shared* copy of a route contains — #73 criterion 6.
 *
 * > Privacy zones (#21) are applied to a **shared** route in the payload, not
 * > in the rendering — a test asserts on the raw shared representation. And
 * > where truncation would make the route unusable, the UI says so rather than
 * > sharing a broken route.
 *
 * ## Why this is not a second trimmer
 *
 * The trimming itself is `detail/privacy.ts`'s `sharedTrack`, unchanged and
 * uncopied. That function already implements ADR 0004 decision B — the
 * symmetric jitter, the deterministic draw keyed on the pair, the refusal to
 * join across a withheld run — and a route needs exactly the same rule. A
 * second implementation of a privacy decision is how the two versions of it
 * come to disagree, and only one of them would be the one anybody audited.
 *
 * What this module adds is the part that is *different* about a route, and it
 * is one thing, stated by #73 itself:
 *
 * > An activity trace can be truncated at both ends after the fact. **A route
 * > is a plan, and its endpoints are usually the athlete's front door** — that
 * > is the entire point of a route. There is no "hide the first 200 m" that
 * > leaves a usable route.
 *
 * So a ride whose first kilometre is withheld is still a shareable ride, and a
 * route whose first sample is withheld is **not a shareable route**. That
 * asymmetry is {@link RouteShare.usable}, and it is why this file exists rather
 * than the view calling `sharedTrack` directly.
 *
 * ⚠️ **`usable: false` is not a rendering hint.** It means the payload below
 * describes a different journey from the one the rider saved, and publishing it
 * would hand a reader a route that starts somewhere the rider never starts.
 */

import type { PrivacyZoneRecord, RouteRecord } from '@onyourleft/store';
import { sharedTrack, type SharedTrack } from '../detail/privacy';

/** Why a trimmed route can no longer be shared as the route it is. */
export type RouteShareFault =
  /** Every sample fell inside a zone. There is nothing left at all. */
  | 'nothing-remains'
  /** The route no longer starts where it starts. */
  | 'start-withheld'
  /** The route no longer ends where it ends. */
  | 'end-withheld';

/** A route as a reader elsewhere would receive it. */
export interface RouteShare {
  readonly name: string;
  /** The trimmed geometry, in `sharedTrack`'s runs-and-gaps shape. */
  readonly track: SharedTrack;
  /**
   * Whether this payload is still the route the rider saved.
   *
   * `false` whenever {@link faults} is non-empty. Kept as its own field rather
   * than derived at every call site, because "is the array empty" is the check
   * a caller forgets and this is the one that must not be forgotten.
   */
  readonly usable: boolean;
  /** Every reason it is not, in the order below. Empty when `usable`. */
  readonly faults: readonly RouteShareFault[];
}

/**
 * The wording a rider is shown before a route becomes public.
 *
 * ⚠️ **#73's fifth criterion is about these exact words**, and it rules out the
 * obvious version: *"Making a route public warns, in specific words, that its
 * start and end points will be visible and that a route usually starts at home.
 * A generic 'this will be public' notice does not convey the actual risk."*
 *
 * So the text names the thing rather than the category. It is a constant rather
 * than a string in a component so that the assertion in `share.test.ts` is
 * against the words a rider actually sees; a test that re-typed them would pass
 * against a component that had been softened.
 */
export const PUBLIC_ROUTE_WARNING =
  'Anyone will be able to see this route, including where it starts and where it ends. ' +
  'Most routes start at home. A privacy zone hides the roads inside it, but a route that ' +
  'begins inside one cannot be shared at all — it would no longer be the route.';

/** What a shared copy of this route would contain, and whether it is still one. */
export function routeShare(route: RouteRecord, zones: readonly PrivacyZoneRecord[]): RouteShare {
  const positions = route.profile.positions;
  const track = sharedTrack({
    // The jitter is keyed on (id, zone id) and needs only to be *deterministic*
    // in the pair — see `trimRadius`. A route's own id is that key here, so two
    // shares of the same route are trimmed identically forever, which is the
    // property ADR 0004 decision B asks for.
    activityId: route.id,
    latitude: positions.map((point) => point.latitude),
    longitude: positions.map((point) => point.longitude),
    zones,
  });

  const faults: RouteShareFault[] = [];
  const first = track.segments[0]?.points[0];
  const last = track.segments.at(-1)?.points.at(-1);
  if (first === undefined || last === undefined) {
    faults.push('nothing-remains');
  } else {
    // Index 0 and the last index, not "near" them. A route that lost its first
    // sample lost its start; there is no tolerance that makes that acceptable,
    // because the whole value of the endpoint is that it is the endpoint.
    if (first.index !== 0) faults.push('start-withheld');
    if (last.index !== positions.length - 1) faults.push('end-withheld');
  }

  return { name: route.name, track, usable: faults.length === 0, faults };
}

/** What to tell a rider about a route that cannot be shared. One sentence each. */
export const ROUTE_SHARE_FAULT_TEXT: Readonly<Record<RouteShareFault, string>> = {
  'nothing-remains':
    'Every part of this route is inside one of your privacy zones, so a shared copy would be empty.',
  'start-withheld':
    'This route starts inside one of your privacy zones. A shared copy would begin somewhere ' +
    'else, so it would not be this route.',
  'end-withheld':
    'This route ends inside one of your privacy zones. A shared copy would stop somewhere else, ' +
    'so it would not be this route.',
};
