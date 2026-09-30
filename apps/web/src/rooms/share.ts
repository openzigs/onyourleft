// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The route a room rides** (#784): what the creator's app sends, and what
 * every rider — the creator included — rides.
 *
 * ## One road, from one file
 *
 * The creator's saved route is written as GPX (`@onyourleft/fit`'s own route
 * writer, with no name and no times) and that TEXT is what the room relays,
 * by the SHA-256 of its bytes (`@onyourleft/protocol`'s `routeRef`). Every
 * rider then rides the profile read back out of that same text — the creator
 * too — so nobody rides a road the others do not: a GPX round trip moves a
 * route by rounding, and a creator riding their own un-rounded profile would
 * be a few centimetres away from the room's on every grid point.
 *
 * ## What never leaves — ADR 0004 B, C and E
 *
 * **A route that goes anywhere inside one of the creator's privacy zones is
 * refused before a byte is built** ({@link sharedRoomRoute}): a route whose
 * START is inside one is refused with `routes/share.ts`'s own sentence, which
 * #784 names; and so is one whose END is, and one that passes through a zone
 * on the way — a ride's shared copy may be trimmed, but a route that is
 * missing a stretch is a different route, and a group ride shares the whole
 * road. There is no trim here to get wrong: the refusal is the rule.
 *
 * The name the rider gave the route is not sent either: the room is "the
 * room's route" to everybody in it.
 *
 * ## A route that came from the room is checked before it is ridden
 *
 * {@link roomRouteFrom} recomputes the SHA-256 of what the instance handed
 * back and refuses anything that is not the room's `routeRef` — so an
 * instance (or anything between) cannot hand a rider a different road from
 * the one the room simulates, and a hand-edited copy is not ridden.
 */

import type { RouteProfile } from '@onyourleft/domain';
import { decodeGpxRoute, encodeGpxRoute } from '@onyourleft/fit';
import type { PrivacyZoneRecord } from '@onyourleft/store';

import { sharedTrack } from '../detail/privacy';
import { ROUTE_SHARE_FAULT_TEXT } from '../routes/share';

/**
 * The most UTF-8 bytes a room's route may be: the instance's own limit
 * (`apps/instance` §`rooms.ts` `MAXIMUM_ROUTE_BYTES`), refused HERE so a
 * route too long for it sends nothing.
 */
export const MAXIMUM_ROOM_ROUTE_BYTES = 900 * 1024;

/** A grade step, rounded to a tenth of a percent: the room's arithmetic, not the road's. */
const GRADE_STEP = 10;

/** One of the rider's own routes, as much of it as a room needs. */
export interface RoomRouteSource {
  readonly id: string;
  readonly profile: RouteProfile;
}

/** What the room rides by: a finish line and a grade at every distance. */
export interface RoomCourse {
  readonly lengthMetres: number;
  /** `[fromMetres, percent]` steps, the first from 0, ascending. */
  readonly grades: readonly (readonly [number, number])[];
}

/** Why a route cannot be a room's. */
export type RoomRouteRefusal =
  'start-in-a-zone' | 'end-in-a-zone' | 'through-a-zone' | 'too-long' | 'unreadable';

/** One sentence for each. */
export const ROOM_ROUTE_REFUSAL_TEXT: Readonly<Record<RoomRouteRefusal, string>> = {
  // #784 names this sentence: the route share's own.
  'start-in-a-zone': ROUTE_SHARE_FAULT_TEXT['start-withheld'],
  'end-in-a-zone': ROUTE_SHARE_FAULT_TEXT['end-withheld'],
  'through-a-zone':
    'This route passes through one of your privacy zones. A room shares the whole road with ' +
    'the riders you invite, so this route cannot be a room’s.',
  'too-long':
    'This route is too long to share in a room. Choose a shorter one, or re-import it with a ' +
    'coarser spacing.',
  unreadable: 'This route could not be written for a room.',
};

/** The route a room is made with, and the road everybody in it rides. */
export interface SharedRoomRoute {
  /** The GPX the room relays. Its bytes' SHA-256 is the room's `routeRef`. */
  readonly gpx: string;
  readonly loop: boolean;
  readonly course: RoomCourse;
  /** The profile read back from {@link gpx}: what the creator rides, as the others do. */
  readonly profile: RouteProfile;
}

export type SharedRoomRouteAnswer =
  | ({ readonly kind: 'shared' } & SharedRoomRoute)
  | { readonly kind: 'refused'; readonly reason: RoomRouteRefusal };

/** The course the room re-simulates, from the profile everybody rides. */
export function roomCourse(profile: RouteProfile): RoomCourse {
  const grades: [number, number][] = [];
  profile.grades.forEach((grade, index) => {
    const percent = Math.round(grade * GRADE_STEP) / GRADE_STEP;
    if (grades.length > 0 && grades[grades.length - 1]?.[1] === percent) return;
    grades.push([index === 0 ? 0 : index * (profile.resolution as number), percent]);
  });
  return { lengthMetres: profile.totalDistance, grades };
}

/** The profile a room's GPX rides as, or `undefined` for text that is not one. */
function profileOf(gpx: string, loop: boolean): RouteProfile | undefined {
  try {
    return decodeGpxRoute(gpx, { loop }).profile;
  } catch {
    // A loop whose written ends are further apart than a loop allows: ride
    // the same points as a line, rather than refuse a route the rider saved.
    try {
      return loop ? decodeGpxRoute(gpx, { loop: false }).profile : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * The route a room is made with — or why not, having built nothing.
 *
 * @param zones the creator's privacy zones: a route inside any of them is refused.
 */
export function sharedRoomRoute(
  route: RoomRouteSource,
  zones: readonly PrivacyZoneRecord[],
): SharedRoomRouteAnswer {
  const positions = route.profile.positions;
  const track = sharedTrack({
    activityId: route.id,
    latitude: positions.map((point) => point.latitude),
    longitude: positions.map((point) => point.longitude),
    zones,
  });
  const first = track.segments[0]?.points[0];
  const last = track.segments.at(-1)?.points.at(-1);
  if (first === undefined || first.index !== 0)
    return { kind: 'refused', reason: 'start-in-a-zone' };
  if (last === undefined || last.index !== positions.length - 1) {
    return { kind: 'refused', reason: 'end-in-a-zone' };
  }
  if (track.trimmedPoints > 0 || track.segments.length !== 1) {
    return { kind: 'refused', reason: 'through-a-zone' };
  }
  const gpx = encodeGpxRoute({ name: undefined, profile: route.profile }).text;
  if (new TextEncoder().encode(gpx).byteLength > MAXIMUM_ROOM_ROUTE_BYTES) {
    return { kind: 'refused', reason: 'too-long' };
  }
  const loop = route.profile.loop;
  const profile = profileOf(gpx, loop);
  if (profile === undefined) return { kind: 'refused', reason: 'unreadable' };
  return { kind: 'shared', gpx, loop: profile.loop, course: roomCourse(profile), profile };
}

/** The SHA-256 of `text`'s UTF-8 bytes, lower-case hex, through Web Crypto. */
export async function routeDigest(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The road a room's route rides as — or `undefined` when the text is not the
 * room's (its SHA-256 is not `routeRef`) or is not a route at all.
 */
export async function roomRouteFrom(
  gpx: string,
  routeSha256: string,
  loop: boolean,
): Promise<RouteProfile | undefined> {
  if ((await routeDigest(gpx)) !== routeSha256) return undefined;
  return profileOf(gpx, loop);
}
