// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the rooms tests share (#784, #785): a route due north of a fixed home,
 * a privacy zone along it, and a scripted instance that answers the rooms
 * routes as `apps/instance` does. Test support, never shipped.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  unixSeconds,
  type RouteProfile,
} from '@onyourleft/domain';
import { athleteId, privacyZoneId, type PrivacyZoneRecord } from '@onyourleft/store';

import { INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import type { InstanceSend } from '../instance/instance-transport';
import type { RaceResultRow } from '../net/rooms-port';
import { routeDigest, sharedRoomRoute } from './share';

const METRES_PER_DEGREE_LATITUDE = 111_194.93;

/** Home: every fixture route starts here, going north. */
export const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

/** A privacy zone `centreMetresNorth` of home. */
export function zoneNorth(centreMetresNorth: number, radius = 300): PrivacyZoneRecord {
  return {
    id: privacyZoneId(`zone-${String(centreMetresNorth)}`),
    athleteId: athleteId('athlete-a'),
    centre: geographicPosition(
      degreesLatitude(HOME.latitude + centreMetresNorth / METRES_PER_DEGREE_LATITUDE),
      degreesLongitude(HOME.longitude),
    ),
    radius: metres(radius),
    label: 'home',
    createdAt: unixSeconds(1),
  };
}

/** A route due north from home, up then down, `length` metres long. */
export function northProfile(length: number, every = 20): RouteProfile {
  const points = [];
  for (let along = 0; along <= length; along += every) {
    points.push({
      position: geographicPosition(
        degreesLatitude(HOME.latitude + along / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(HOME.longitude),
      ),
      elevation: altitudeMetres(20 + (along < length / 2 ? along : length - along) * 0.04),
    });
  }
  return routeProfile(points);
}

/** A room's route as the maker's app sends it, and its routeRef. */
export async function roomRoute(
  length = 2_000,
): Promise<{ readonly gpx: string; readonly sha256: string }> {
  const shared = sharedRoomRoute({ id: 'fixture', profile: northProfile(length) }, []);
  if (shared.kind !== 'shared') throw new Error('the fixture route was refused');
  return { gpx: shared.gpx, sha256: await routeDigest(shared.gpx) };
}

export const ROOMS_ORIGIN = 'https://ride.example';

/** A device signed in to {@link ROOMS_ORIGIN}. */
export function signedInStorage(): Storage {
  const map = new Map<string, string>([
    [
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({ origin: ROOMS_ORIGIN, instanceAthleteId: 'ath-1' }),
    ],
    [
      INSTANCE_SESSION_STORAGE_KEY,
      JSON.stringify({ origin: ROOMS_ORIGIN, token: 'session-token' }),
    ],
  ]);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

/** One request the scripted instance saw. */
export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly authorization: string | null;
}

/**
 * An instance that answers the rooms routes — scripted, with the answers a
 * test may change — and keeps every request it saw.
 */
export class ScriptedInstance {
  readonly seen: SeenRequest[] = [];
  created = {
    status: 200,
    body: { roomId: 'room-abc', code: 'ABCDE-FGHJK-MNPQR', routeSha256: '' } as unknown,
  };
  joined: { status: number; body: unknown } = { status: 404, body: null };
  route: { status: number; body: unknown } = { status: 404, body: null };
  started: { status: number; body: unknown } = { status: 200, body: { status: 'started' } };
  results: { status: number; body: unknown } = { status: 404, body: null };
  ticket: { status: number; body: unknown } = {
    status: 200,
    body: { ticket: 'the-ticket', expiresAt: 1 },
  };

  /** The room joined by code is `routeSha256`'s, and its route is `gpx`. */
  offer(roomId: string, kind: 'group' | 'race', gpx: string, sha256: string): void {
    this.joined = {
      status: 200,
      body: { roomId, kind, ridingPosition: 'hoods', loop: false, routeSha256: sha256 },
    };
    this.route = { status: 200, body: { sha256, gpx } };
  }

  /** A race's published result. */
  publish(rows: readonly RaceResultRow[]): void {
    this.results = { status: 200, body: { rows } };
  }

  send: InstanceSend = (url, init) => {
    const path = url.slice(ROOMS_ORIGIN.length);
    const headers = new Headers(init.headers);
    const body: unknown = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    this.seen.push({
      method: init.method ?? 'GET',
      path,
      body,
      authorization: headers.get('authorization'),
    });
    const answer =
      path === '/v1/rooms'
        ? this.created
        : path === '/v1/rooms/join'
          ? this.joined
          : path.endsWith('/route')
            ? this.route
            : path.endsWith('/start')
              ? this.started
              : path.endsWith('/results')
                ? this.results
                : path.endsWith('/ticket')
                  ? this.ticket
                  : { status: 404, body: null };
    return Promise.resolve(
      new Response(answer.body === null ? '' : JSON.stringify(answer.body), {
        status: answer.status,
      }),
    );
  };
}
