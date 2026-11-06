// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Segments on this device's instance, and the leaderboards ranked on them**
 * (#68): what the segment screens may ask of the instance, and the one
 * production implementation of it.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method of
 * {@link LeaderboardPort} (WIRE003) and every export of this file (WIRE002),
 * and `main.tsx` is the only production code that names
 * {@link createLeaderboardPort}.
 *
 * ## What leaves this device, and when
 *
 * Only what the rider presses a button for, and every request SEALED through
 * `instance-transport.ts`, the one module this client sends instance traffic
 * through (ADR 0036 D-3 (a)):
 *
 * - **Publishing a segment** sends its definition — its name, sport, path,
 *   endpoint radius and bearing tolerance (`@onyourleft/domain`
 *   §`publishedDefinitionOf`). The path is a stretch of the rider's own ride,
 *   so it is offered only for a segment that is `public` here, and refused
 *   when ANY point of it lies in one of the rider's privacy zones as they are
 *   NOW ({@link publishRefusal}) — a zone added since the segment was made
 *   counts. ADR 0004 C: the bytes that cross a boundary hold no point inside a
 *   zone, and a segment's path is served to every rider on the instance.
 * - **Sharing efforts** sends, per ride, its visibility (`public`) and each
 *   effort's start, elapsed time and three-state visibility — never a
 *   position. The ride must already be synced (the device knows its file's
 *   hash only from the sync base). An effort with an end in a privacy zone,
 *   and every effort on a segment whose path enters one (ADR 0004 C: an
 *   effort whose span intersects a zone is not published), is sent
 *   `private-match`: the instance keeps it for the rider's own board and
 *   ranks it on nobody else's. The ride is made `public` HERE as well, so the
 *   device and the instance never disagree about it (ADR 0004's one
 *   vocabulary) — and put back as it was when either instance call fails, so
 *   a share that did not happen changes nothing.
 * - **Withdrawing efforts** takes this segment's efforts off and nothing
 *   else: the ride's visibility is the rider's, and its efforts on other
 *   segments stay where they are.
 * - **Adding another rider's segment** fetches its definition, checks it is
 *   the one its identifier names, and stores it as this device's own segment,
 *   under that identifier, to match this device's rides against.
 *
 * ## Nothing for a rider with no instance
 *
 * {@link LeaderboardPort.offered} reads this device's storage and nothing
 * else. With no instance, or one this copy of the app cannot seal to, it is
 * `false`: no section renders and nothing is sent. A rider with no instance
 * loses the boards and nothing else (ADR 0036 D-3).
 *
 * ## Untrusted on arrival
 *
 * Every answer is held to its shape: a board's names to the display-name rule,
 * its rows to at most {@link MAXIMUM_BOARD_ROWS}, a definition to
 * `parsePublishedDefinition` and to the digest its identifier claims. Anything
 * else is `unavailable`, never shown.
 */

import {
  checkDisplayName,
  PUBLISHED_SEGMENT_ID,
  parsePublishedDefinition,
  publishedDefinitionOf,
  publishedSegmentId,
  segmentFromPublished,
  distanceBetween,
  type GeographicPosition,
  type PrivacyCircle,
  type Sha256,
} from '@onyourleft/domain';
import {
  segmentId as asSegmentId,
  webCryptoSha256,
  type ActivityId,
  type AthleteId,
  type PrivacyZoneRecord,
  type SegmentEffortRecord,
  type SegmentId,
  type SegmentRecord,
  type SyncBaseRecord,
  type Visibility,
} from '@onyourleft/store';

import {
  heldInstanceSession,
  heldSealedSession,
  INSTANCE_AGREEMENT_STORAGE_KEYS,
  type InstanceStorage,
  type SealingDependencies,
} from './instance-port';
import { sealedRouteGate } from './instance-pin';
import { readInstanceAccount } from './sign-in';

/** The most rows a board may arrive with: the instance's own limit (`segments.ts`). */
export const MAXIMUM_BOARD_ROWS = 50;

/** Who a board ranks: everybody on this instance the rider may see, or the rider alone. */
export type BoardScope = 'instance' | 'personal';

/** Over what time. */
export type BoardPeriod = 'all-time' | 'last-90-days' | 'last-30-days';

/** One row, as it arrived. */
export interface BoardRow {
  readonly rank: number;
  readonly rider: string;
  readonly yours: boolean;
  readonly elapsedSeconds: number;
}

/** A board, as it arrived. */
export interface InstanceBoard {
  readonly scope: BoardScope;
  readonly period: BoardPeriod;
  readonly rows: readonly BoardRow[];
}

/** A published segment as the instance lists it. */
export interface InstanceSegment {
  readonly segmentId: string;
  readonly name: string;
  readonly sport: 'ride' | 'run';
  readonly distanceMetres: number;
  readonly yours: boolean;
}

/** Whether one of this device's segments is on the instance. */
export type SegmentStanding =
  /**
   * Not asked: the segment is not offered to the instance, for this reason.
   * `held` when this device published it, or shared efforts on it, before it
   * was withheld — known from this device's own record ({@link HELD_STORAGE_KEY}),
   * never from asking — so the rider can still take it off.
   */
  | { readonly kind: 'withheld'; readonly refusal: string; readonly held?: HeldSegment }
  | { readonly kind: 'published'; readonly segmentId: string; readonly yours: boolean }
  | { readonly kind: 'not-published'; readonly segmentId: string }
  | { readonly kind: 'unavailable' };

/** What sharing or withdrawing came to, ride by ride. */
export interface ShareOutcome {
  /** Rides whose efforts the instance took. */
  readonly rides: number;
  /** Rides not synced yet: the device does not know their file's hash. */
  readonly notSynced: number;
  /** Rides the instance did not take, or could not be asked about. */
  readonly failed: number;
}

/** What the segment screens may ask of the instance. */
export interface LeaderboardPort {
  /** Whether to show any of it — from this device's storage, sending nothing. */
  offered(): boolean;
  /** The instance's host, for the sentence that says whose board it is. */
  instanceName(): string | undefined;
  /** Why this segment may not be published, in a sentence, or `undefined` when it may. */
  publishRefusal(segment: SegmentRecord): Promise<string | undefined>;
  /**
   * Whether this device's segment is on the instance, by its definition's
   * digest — asked only of a segment {@link publishRefusal} would offer, or
   * one that came from the instance: the digest of a segment the client
   * refuses to send is a fingerprint of it, and is not sent either.
   */
  standing(segment: SegmentRecord): Promise<SegmentStanding>;
  publish(segment: SegmentRecord): Promise<'published' | 'refused' | 'unavailable'>;
  /** Withdraw a segment the rider published, with every effort anybody shared on it. */
  withdrawSegment(segmentId: string): Promise<boolean>;
  board(
    segmentId: string,
    scope: BoardScope,
    period: BoardPeriod,
  ): Promise<InstanceBoard | undefined>;
  /** Share the rider's efforts on a published segment, ride by ride. */
  share(segment: SegmentRecord, efforts: readonly SegmentEffortRecord[]): Promise<ShareOutcome>;
  /** Take them off this segment's board again; the rides' visibility is left as it is. */
  withdraw(segment: SegmentRecord, efforts: readonly SegmentEffortRecord[]): Promise<ShareOutcome>;
  /** The segments published on the instance, newest first, or `undefined` when it could not be asked. */
  listSegments(): Promise<readonly InstanceSegment[] | undefined>;
  /** Add one to this device, to match its rides against. */
  addSegment(segmentId: string): Promise<'added' | 'already' | 'unavailable'>;
}

/** The device's own store, as far as this port needs it. */
export interface LeaderboardStore {
  listPrivacyZones(owner: AthleteId): Promise<PrivacyZoneRecord[]>;
  listSyncBase(owner: AthleteId): Promise<SyncBaseRecord[]>;
  getActivity(
    owner: AthleteId,
    id: ActivityId,
  ): Promise<{ readonly visibility: Visibility } | undefined>;
  setActivityVisibility(owner: AthleteId, id: ActivityId, visibility: Visibility): Promise<boolean>;
  getSegment(owner: AthleteId, id: SegmentId): Promise<SegmentRecord | undefined>;
  putSegment(record: SegmentRecord): Promise<SegmentId>;
}

export interface LeaderboardPortDependencies extends SealingDependencies {
  readonly store: () => LeaderboardStore;
  readonly athleteId: AthleteId;
  readonly sha256?: Sha256;
}

/** A segment this device published, or shared efforts on, on the instance it is signed in to. */
export interface HeldSegment {
  /** Its identifier there: the digest it was published under. */
  readonly segmentId: string;
  /** This device published it, so may withdraw it. */
  readonly yours: boolean;
  /** This device shared efforts on it, so may take them off. */
  readonly shared: boolean;
}

/**
 * Where this device records which of its segments it published, or shared
 * efforts on, and under which identifier — for the instance it is signed in
 * to, by its address. Only identifiers: no name, no path. Forgotten on a
 * disconnect and an erase, with the rest of what names the instance
 * (`instance-port.ts` §`INSTANCE_AGREEMENT_STORAGE_KEYS`).
 */
export const HELD_STORAGE_KEY = INSTANCE_AGREEMENT_STORAGE_KEYS[4];

type HeldRecord = Readonly<Record<string, HeldSegment>>;

/** This device's record for `origin`, or none: anything else is read as none. */
function readHeld(storage: InstanceStorage, origin: string): HeldRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(HELD_STORAGE_KEY) ?? 'null');
  } catch {
    return {};
  }
  if (!isRecord(parsed) || parsed.origin !== origin || !isRecord(parsed.segments)) return {};
  const held: Record<string, HeldSegment> = {};
  for (const [local, value] of Object.entries(parsed.segments)) {
    if (
      isRecord(value) &&
      typeof value.segmentId === 'string' &&
      PUBLISHED_SEGMENT_ID.test(value.segmentId) &&
      typeof value.yours === 'boolean' &&
      typeof value.shared === 'boolean'
    ) {
      held[local] = { segmentId: value.segmentId, yours: value.yours, shared: value.shared };
    }
  }
  return held;
}

/** What a rider is told when a segment is not offered for publishing. */
export const NOT_PUBLIC_REFUSAL =
  'This segment is private on this device, so it is not offered to your instance.';
export const IN_A_ZONE_REFUSAL =
  'Part of this segment is in one of your privacy zones, so it is not offered to your instance.';
export const FROM_THE_INSTANCE_REFUSAL =
  'This segment came from your instance, so it is already there.';

/** The mean Earth radius, in metres, for the flat neighbourhood of one zone. */
const EARTH_RADIUS_METRES = 6_371_008.8;

/**
 * Whether the straight line from `a` to `b` comes within `zone`: its closest
 * point to the zone's centre, on a plane laid flat around that centre. Flat
 * is close enough across one zone and one gap in a recording.
 */
function lineEntersZone(
  a: GeographicPosition,
  b: GeographicPosition,
  zone: PrivacyCircle,
): boolean {
  const radians = Math.PI / 180;
  const across = Math.cos(zone.centre.latitude * radians);
  const east = (position: GeographicPosition): number => {
    let degrees = position.longitude - zone.centre.longitude;
    if (degrees > 180) degrees -= 360;
    if (degrees < -180) degrees += 360;
    return degrees * radians * EARTH_RADIUS_METRES * across;
  };
  const north = (position: GeographicPosition): number =>
    (position.latitude - zone.centre.latitude) * radians * EARTH_RADIUS_METRES;
  const [ax, ay, bx, by] = [east(a), north(a), east(b), north(b)];
  const [dx, dy] = [bx - ax, by - ay];
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length));
  return Math.hypot(ax + along * dx, ay + along * dy) <= zone.radius;
}

/**
 * Whether any part of `path` lies inside any of `zones` — every point, and
 * every line between two neighbouring points, not only the two ends: a
 * published path is served to every rider on the instance, and a renderer
 * draws those lines, so a segment that passes THROUGH a zone would publish
 * where it went inside (ADR 0004 C). The lines matter where a recording has a
 * gap, or a zone is small: two points either side of a zone, both outside it.
 */
export function pathEntersPrivacyZone(
  path: readonly GeographicPosition[],
  zones: readonly PrivacyCircle[],
): boolean {
  return zones.some(
    (zone) =>
      path.some((position) => distanceBetween(zone.centre, position) <= zone.radius) ||
      path.some((position, index) => index > 0 && lineEntersZone(path[index - 1]!, position, zone)),
  );
}

/**
 * Why `segment` may not be published, or `undefined` when it may. Pure: the
 * zones are the rider's as they are now.
 */
export function publishRefusal(
  segment: SegmentRecord,
  zones: readonly PrivacyZoneRecord[],
  publishedId: string,
): string | undefined {
  if (segment.id === publishedId) return FROM_THE_INSTANCE_REFUSAL;
  if (segment.visibility !== 'public') return NOT_PUBLIC_REFUSAL;
  if (pathEntersPrivacyZone(segment.geometry, zones)) return IN_A_ZONE_REFUSAL;
  return undefined;
}

const SCOPES: readonly BoardScope[] = ['instance', 'personal'];
const VISIBILITIES: readonly Visibility[] = ['private', 'followers', 'public'];
const PERIODS: readonly BoardPeriod[] = ['all-time', 'last-90-days', 'last-30-days'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A board's body, or `undefined` when it is not one. */
export function parseBoard(body: unknown): InstanceBoard | undefined {
  if (!isRecord(body)) return undefined;
  const { scope, period, rows, rankedBy } = body;
  if (!SCOPES.includes(scope as BoardScope) || !PERIODS.includes(period as BoardPeriod)) {
    return undefined;
  }
  if (rankedBy !== 'elapsed') return undefined;
  if (!Array.isArray(rows) || rows.length > MAXIMUM_BOARD_ROWS) return undefined;
  const parsed: BoardRow[] = [];
  for (const row of rows as unknown[]) {
    if (!isRecord(row) || Object.keys(row).sort().join() !== 'elapsedSeconds,rank,rider,yours') {
      return undefined;
    }
    const { rank, rider, yours, elapsedSeconds } = row;
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank !== parsed.length + 1) {
      return undefined;
    }
    if (typeof rider !== 'string' || typeof yours !== 'boolean') return undefined;
    const name = checkDisplayName(rider);
    if (!name.ok) return undefined;
    if (
      typeof elapsedSeconds !== 'number' ||
      !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds <= 0
    ) {
      return undefined;
    }
    parsed.push({ rank, rider: name.name, yours, elapsedSeconds });
  }
  return { scope: scope as BoardScope, period: period as BoardPeriod, rows: parsed };
}

/** A list page's segments, or `undefined` when it is not one. */
export function parseSegmentList(body: unknown): InstanceSegment[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.items)) return undefined;
  const segments: InstanceSegment[] = [];
  for (const item of body.items as unknown[]) {
    if (!isRecord(item)) return undefined;
    const { segmentId, name, sport, distanceMetres, yours } = item;
    if (typeof segmentId !== 'string' || !PUBLISHED_SEGMENT_ID.test(segmentId)) return undefined;
    if (typeof name !== 'string' || (sport !== 'ride' && sport !== 'run')) return undefined;
    if (typeof distanceMetres !== 'number' || !Number.isFinite(distanceMetres)) return undefined;
    if (typeof yours !== 'boolean') return undefined;
    segments.push({ segmentId, name, sport, distanceMetres, yours });
  }
  return segments;
}

/** The production {@link LeaderboardPort}: `main.tsx` builds it, and nothing else in the client. */
export function createLeaderboardPort(dependencies: LeaderboardPortDependencies): LeaderboardPort {
  const session = heldSealedSession(dependencies);
  const sha256 = dependencies.sha256 ?? webCryptoSha256;
  const { athleteId } = dependencies;
  const now = dependencies.now ?? (() => Date.now());

  const idOf = (segment: SegmentRecord): Promise<string> =>
    publishedSegmentId(publishedDefinitionOf(segment), sha256);

  /** A sealed call's answer, or `undefined` when the instance could not be asked. */
  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Readonly<Record<string, unknown>>,
    query?: Readonly<Record<string, string>>,
  ): Promise<{ status: number; body: unknown } | undefined> {
    try {
      const held = await session();
      if (held.kind === 'closed') return undefined;
      // The query goes as a structured query: a sealed call takes a plain path
      // and encodes its query itself, after the path is checked (`sync.ts`).
      return await held.sealed.call(method, path, {
        token: held.token,
        ...(body === undefined ? {} : { body }),
        ...(query === undefined ? {} : { query }),
      });
    } catch {
      return undefined;
    }
  }

  /** Each ride's synced file, by its activity id, from the sync base. */
  async function contents(): Promise<Map<string, string>> {
    const base = await dependencies.store().listSyncBase(athleteId);
    return new Map(
      base
        .filter((row) => row.kind === 'activity' && row.activityId !== null)
        .map((row) => [row.activityId as string, row.key]),
    );
  }

  /** The efforts grouped by their ride, excluded ones left out. */
  function byRide(efforts: readonly SegmentEffortRecord[]): Map<ActivityId, SegmentEffortRecord[]> {
    const rides = new Map<ActivityId, SegmentEffortRecord[]>();
    for (const effort of efforts) {
      if (effort.visibility === 'excluded') continue;
      rides.set(effort.activityId, [...(rides.get(effort.activityId) ?? []), effort]);
    }
    return rides;
  }

  const origin = (): string | undefined => readInstanceAccount(dependencies.storage)?.origin;

  /** What this device recorded of `segment` on the instance it is signed in to. */
  function heldOf(segment: SegmentRecord): HeldSegment | undefined {
    const at = origin();
    return at === undefined ? undefined : readHeld(dependencies.storage, at)[segment.id];
  }

  /** Rewrite this device's record for the instance it is signed in to. */
  function rewriteHeld(rewrite: (all: Record<string, HeldSegment>) => void): void {
    const at = origin();
    if (at === undefined) return;
    const all: Record<string, HeldSegment> = { ...readHeld(dependencies.storage, at) };
    rewrite(all);
    for (const [key, held] of Object.entries(all)) {
      if (!held.yours && !held.shared) delete all[key];
    }
    dependencies.storage.setItem(HELD_STORAGE_KEY, JSON.stringify({ origin: at, segments: all }));
  }

  /** Record what this device now holds of one of its segments on the instance. */
  function hold(
    segment: SegmentRecord,
    change: (was: HeldSegment | undefined) => HeldSegment | undefined,
  ): void {
    rewriteHeld((all) => {
      const next = change(all[segment.id]);
      if (next === undefined) delete all[segment.id];
      else all[segment.id] = next;
    });
  }

  /** One instance call, as whether it was taken. */
  const took = async (path: string, body: Readonly<Record<string, unknown>>): Promise<boolean> =>
    (await call('POST', path, body))?.status === 200;

  /**
   * Share one ride's efforts: the ride is made `public` here first, so no
   * effort is ever ranked from a ride this device has not made public, then
   * on the instance, then its efforts sent. When either instance call fails
   * the ride is put back as it was, here and there — on the instance to what
   * the instance itself answered it had been, which need not be what this
   * device had: a share that did not happen changes nothing.
   */
  async function shareRide(
    activity: ActivityId,
    file: string,
    segmentId: string,
    efforts: readonly SegmentEffortRecord[],
    zoned: boolean,
  ): Promise<boolean> {
    const store = dependencies.store();
    const before = (await store.getActivity(athleteId, activity))?.visibility;
    if (before === undefined) return false;
    if (!(await store.setActivityVisibility(athleteId, activity, 'public'))) return false;
    const visibilityPath = `/v1/sync/records/${file}/visibility`;
    const made = await call('POST', visibilityPath, { visibility: 'public' });
    const madePublic = made?.status === 200;
    // What the instance had: its own answer. One it did not give is taken as
    // `private`, the default — putting back too little never ranks anything.
    const previous =
      isRecord(made?.body) && VISIBILITIES.includes(made.body.previous as Visibility)
        ? (made.body.previous as Visibility)
        : 'private';
    if (
      madePublic &&
      (await took(`/v1/segments/${segmentId}/efforts/${file}`, {
        efforts: efforts.map((effort) => ({
          startedAt: Math.round(effort.startedAt),
          elapsedSeconds: effort.elapsed,
          visibility: zoned ? 'private-match' : effort.visibility,
        })),
      }))
    ) {
      return true;
    }
    if (madePublic && previous !== 'public') await took(visibilityPath, { visibility: previous });
    if (before !== 'public') await store.setActivityVisibility(athleteId, activity, before);
    return false;
  }

  async function sendRides(
    segment: SegmentRecord,
    efforts: readonly SegmentEffortRecord[],
    kind: 'share' | 'withdraw',
  ): Promise<ShareOutcome> {
    // Taking efforts off a segment this device shared on goes by the identifier
    // they were shared under, which this device recorded.
    const segmentId =
      (kind === 'withdraw' ? heldOf(segment)?.segmentId : undefined) ?? (await idOf(segment));
    const content = await contents();
    // ADR 0004 C: an effort whose span intersects a zone is not published.
    // Its span is this segment's path, so a path that enters one of the
    // rider's zones keeps every effort on it to the rider's own board.
    const zoned =
      kind === 'share' &&
      pathEntersPrivacyZone(
        segment.geometry,
        await dependencies.store().listPrivacyZones(athleteId),
      );
    let rides = 0;
    let notSynced = 0;
    let failed = 0;
    for (const [activity, mine] of byRide(efforts)) {
      const file = content.get(activity);
      if (file === undefined) {
        notSynced += 1;
        continue;
      }
      // Withdrawing takes this segment's efforts off and nothing else: the
      // ride's visibility is the rider's, and its efforts on other segments
      // stay ranked.
      const sent =
        kind === 'share'
          ? await shareRide(activity, file, segmentId, mine, zoned)
          : await took(`/v1/segments/${segmentId}/efforts/${file}`, { efforts: [] });
      if (sent) rides += 1;
      else failed += 1;
    }
    if (kind === 'share' && rides > 0) {
      hold(segment, (was) => ({ segmentId, yours: was?.yours ?? false, shared: true }));
    }
    if (kind === 'withdraw' && failed === 0) {
      hold(segment, (was) => (was === undefined ? undefined : { ...was, shared: false }));
    }
    return { rides, notSynced, failed };
  }

  return {
    offered: () => {
      const account = readInstanceAccount(dependencies.storage);
      if (account === undefined || heldInstanceSession(dependencies.storage) === undefined) {
        return false;
      }
      return sealedRouteGate(account, dependencies.loadedFrom).kind === 'open';
    },

    instanceName: () => {
      const account = readInstanceAccount(dependencies.storage);
      if (account === undefined) return undefined;
      try {
        return new URL(account.origin).host;
      } catch {
        return undefined;
      }
    },

    publishRefusal: async (segment) =>
      publishRefusal(
        segment,
        await dependencies.store().listPrivacyZones(athleteId),
        await idOf(segment),
      ),

    standing: async (segment) => {
      const segmentId = await idOf(segment);
      const refusal = publishRefusal(
        segment,
        await dependencies.store().listPrivacyZones(athleteId),
        segmentId,
      );
      // Asked only of a segment that is, or may be, on the instance. One this
      // device published or shared on before is answered from its own record,
      // so the rider can still take it off — and still nothing is asked.
      if (refusal !== undefined && refusal !== FROM_THE_INSTANCE_REFUSAL) {
        const held = heldOf(segment);
        return held === undefined
          ? { kind: 'withheld', refusal }
          : { kind: 'withheld', refusal, held };
      }
      const answer = await call('GET', `/v1/segments/${segmentId}`);
      if (answer === undefined) return { kind: 'unavailable' };
      if (answer.status === 404) return { kind: 'not-published', segmentId };
      if (answer.status !== 200 || !isRecord(answer.body)) return { kind: 'unavailable' };
      return { kind: 'published', segmentId, yours: answer.body.yours === true };
    },

    publish: async (segment) => {
      // The refusal is asked again here, not only by the screen: a guard that
      // lives only in a render is a guard whose absence is invisible.
      const zones = await dependencies.store().listPrivacyZones(athleteId);
      if (publishRefusal(segment, zones, await idOf(segment)) !== undefined) return 'refused';
      const segmentId = await idOf(segment);
      const answer = await call('POST', '/v1/segments', {
        segment: publishedDefinitionOf(segment),
      });
      if (answer === undefined) return 'unavailable';
      if (answer.status !== 200) return 'refused';
      // Recorded, so it can still be withdrawn once it is withheld. Yours only
      // when this call published it, or an earlier one of this device's did.
      const fresh = isRecord(answer.body) && answer.body.published === true;
      hold(segment, (was) => ({
        segmentId,
        yours: fresh || was?.yours === true,
        shared: was?.shared ?? false,
      }));
      return 'published';
    },

    withdrawSegment: async (segmentId) => {
      if (!PUBLISHED_SEGMENT_ID.test(segmentId)) return false;
      const withdrawn = (await call('DELETE', `/v1/segments/${segmentId}`))?.status === 204;
      // Gone, with every effort on it: nothing of it is left to take off.
      if (withdrawn) {
        rewriteHeld((all) => {
          for (const [key, held] of Object.entries(all)) {
            if (held.segmentId === segmentId) delete all[key];
          }
        });
      }
      return withdrawn;
    },

    board: async (segmentId, scope, period) => {
      if (!PUBLISHED_SEGMENT_ID.test(segmentId)) return undefined;
      const answer = await call('GET', `/v1/segments/${segmentId}/leaderboard`, undefined, {
        scope,
        period,
      });
      if (answer?.status !== 200) return undefined;
      return parseBoard(answer.body);
    },

    share: (segment, efforts) => sendRides(segment, efforts, 'share'),
    withdraw: (segment, efforts) => sendRides(segment, efforts, 'withdraw'),

    listSegments: async () => {
      const answer = await call('GET', '/v1/segments', undefined, { limit: '200' });
      if (answer?.status !== 200) return undefined;
      return parseSegmentList(answer.body);
    },

    addSegment: async (segmentId) => {
      if (!PUBLISHED_SEGMENT_ID.test(segmentId)) return 'unavailable';
      const store = dependencies.store();
      if ((await store.getSegment(athleteId, asSegmentId(segmentId))) !== undefined) {
        return 'already';
      }
      const answer = await call('GET', `/v1/segments/${segmentId}`);
      if (answer?.status !== 200 || !isRecord(answer.body)) return 'unavailable';
      const parsed = parsePublishedDefinition(answer.body.definition);
      // The definition must be the one its identifier names: an instance that
      // served another path under this id would have this device match the
      // rider's rides against a road they never chose.
      if (!parsed.ok || (await publishedSegmentId(parsed.definition, sha256)) !== segmentId) {
        return 'unavailable';
      }
      const segment = segmentFromPublished(parsed.definition, {
        id: segmentId,
        createdBy: athleteId,
        createdAt: Math.floor(now() / 1000),
      });
      await store.putSegment({ ...segment, id: asSegmentId(segmentId), createdBy: athleteId });
      return 'added';
    },
  };
}
