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
 * An instance with no keys in front of `send` (#1210): `/v1/instance/keys`
 * answers `unavailable`, as one with no operator secret does, and every other
 * request reaches `send` — so a test that counts what a no-card device sends
 * about a room counts only that. A device with no card reads the keys before
 * a phase-2 call, and sends nothing more to an instance that serves them.
 */
export function keylessInstance<T extends InstanceSend>(send: T): InstanceSend {
  return (url, init) =>
    new URL(url).pathname === '/v1/instance/keys'
      ? Promise.resolve(
          Response.json({ error: { code: 'unavailable', message: 'No keys.' } }, { status: 503 }),
        )
      : send(url, init);
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
  /** #788: `GET /v1/rooms/public`. */
  listing: { status: number; body: unknown } = { status: 200, body: { rooms: [] } };
  /** #788: `POST /v1/rooms/{roomId}/join`. */
  joinedPublic: { status: number; body: unknown } = { status: 404, body: null };
  /** #789: `POST /v1/rooms/{roomId}/reports`. */
  reported: { status: number; body: unknown } = { status: 204, body: null };

  /**
   * #788: a public room listed as `listed`, joined from the listing, its route
   * `gpx`. The listing answers it and nothing else.
   */
  list(
    listed: {
      readonly roomId: string;
      readonly kind: 'group' | 'race';
      readonly startsAt: number;
      readonly lengthMetres: number;
      readonly climbMetres: number;
    },
    gpx: string,
    sha256: string,
  ): void {
    this.listing = {
      status: 200,
      body: { rooms: [{ ridingPosition: 'hoods', drafting: true, loop: false, ...listed }] },
    };
    this.joinedPublic = {
      status: 200,
      body: {
        roomId: listed.roomId,
        kind: listed.kind,
        ridingPosition: 'hoods',
        drafting: true,
        loop: false,
        routeSha256: sha256,
      },
    };
    this.route = { status: 200, body: { sha256, gpx } };
  }

  /**
   * The room joined by code is `routeSha256`'s, and its route is `gpx`; it
   * drafts unless told, and the joiner did not make it unless told (#948).
   */
  offer(
    roomId: string,
    kind: 'group' | 'race',
    gpx: string,
    sha256: string,
    drafting = true,
    creator = false,
  ): void {
    this.joined = {
      status: 200,
      body: {
        roomId,
        kind,
        ridingPosition: 'hoods',
        drafting,
        loop: false,
        routeSha256: sha256,
        creator,
      },
    };
    this.route = { status: 200, body: { sha256, gpx } };
  }

  /** A race's published result. */
  publish(rows: readonly RaceResultRow[]): void {
    this.results = { status: 200, body: { rows } };
  }

  /** How often `/v1/instance/keys` was read: answered `unavailable`, as an instance with no keys does (#1210). */
  keysReads = 0;

  send: InstanceSend = (url, init) => {
    const path = url.slice(ROOMS_ORIGIN.length);
    if (path === '/v1/instance/keys') {
      this.keysReads += 1;
      return Promise.resolve(
        Response.json({ error: { code: 'unavailable', message: 'No keys.' } }, { status: 503 }),
      );
    }
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
        : path === '/v1/rooms/public'
          ? this.listing
          : path === '/v1/rooms/join'
            ? this.joined
            : path.endsWith('/join')
              ? this.joinedPublic
              : path.endsWith('/reports')
                ? this.reported
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
      // A 204 carries no body at all: a `Response` refuses even an empty one.
      new Response(
        answer.body === null ? (answer.status === 204 ? null : '') : JSON.stringify(answer.body),
        { status: answer.status },
      ),
    );
  };
}
