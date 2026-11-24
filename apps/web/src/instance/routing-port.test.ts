// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The route planner's roads, end to end against the REAL instance**
 * (#2008): a device connected to an instance whose routing engine is the fake
 * Valhalla (`apps/instance` §`routing/valhalla-testing.ts`) draws a route, and
 * the planner's own functions — `resolveDraft` and `planElevation`, what the
 * builder screen calls — read the roads and the climbing back. Every call is
 * sealed, through the one instance module.
 *
 * And what must send nothing: a waypoint inside a privacy zone, no instance,
 * and a website's copy. No fixture names a real place.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  RoutingError,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import { ensureDeviceSigningKey, privacyZoneId, type PrivacyZoneRecord } from '@onyourleft/store';
import {
  createStoreHarness,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { addWaypoint, emptyDraft, resolveDraft } from '../routing/draft';
import { planElevation } from '../routing/elevation';
import { RIDING_DEFAULTS } from '../routing/preferences';
import type { LoadedFrom } from './instance-pin';
import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstanceStorage,
} from './instance-port';
import type { InstanceSend } from './instance-transport';
import { createRoutingPort, ZONE_REFUSAL } from './routing-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from './sign-in';
import { LOADED_FROM_A_WEBSITE, LOADED_LOCALLY } from './testing';

interface FakeValhalla {
  readonly requests: { readonly action: string; readonly body: Record<string, unknown> }[];
  failNext(action: string, status: number, body: unknown): void;
  engine(): unknown;
}

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response>; readonly lines: string[] };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: {
    bodyLimitBytes?: number;
    routing?: { engine?: unknown };
  }): Promise<IdentityInstance>;
}

interface ValhallaTesting {
  fakeValhalla(options?: { heights?: readonly (number | null)[] }): FakeValhalla;
  readonly FAKE_VERTICES: number;
}

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
let valhallaTesting: ValhallaTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
  valhallaTesting = (await import(
    /* @vite-ignore */ INSTANCE('routing/valhalla-testing.ts')
  )) as ValhallaTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
});

/** A point just off Null Island: no real place. */
const at = (latitude: number, longitude: number): GeographicPosition =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

const A = at(0.01, 0.01);
const B = at(0.02, 0.015);

async function world(options: { engine?: 'none'; heights?: readonly (number | null)[] } = {}) {
  const valhalla = valhallaTesting.fakeValhalla(
    options.heights === undefined ? {} : { heights: options.heights },
  );
  const w = await testing.startIdentityInstance({
    bodyLimitBytes: 1024 * 1024,
    routing: options.engine === 'none' ? {} : { engine: valhalla.engine() },
  });
  worlds.push(w);
  const seen: string[] = [];
  const send: InstanceSend = async (url, init) => {
    seen.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    return w.instance.handler(new Request(url, init));
  };
  return { w, send, seen, valhalla };
}

function mapStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function zoneAround(centre: GeographicPosition): PrivacyZoneRecord {
  return {
    id: privacyZoneId('zone-1'),
    athleteId: LOCAL_ATHLETE,
    centre,
    radius: metres(200),
    label: 'home',
    createdAt: NOW,
  };
}

async function device(
  send: InstanceSend,
  options: { loadedFrom?: LoadedFrom; zones?: readonly PrivacyZoneRecord[] } = {},
) {
  const harness = createStoreHarness();
  harnesses.push(harness);
  let open: PersistentStore | undefined;
  await harness.write((store) => {
    open = store;
    return ensureLocalAthlete(store, NOW);
  });
  const store = (): PersistentStore => open as PersistentStore;
  const storage = mapStorage();
  const signingKey = () => ensureDeviceSigningKey(store(), LOCAL_ATHLETE, { now: () => NOW });
  const sealing = {
    storage,
    loadedFrom: options.loadedFrom ?? LOADED_LOCALLY,
    signingKey,
    send,
    now: () => NOW * 1000,
  };
  const instance = createInstancePort({
    ...sealing,
    ensureLocalAthlete: () => ensureLocalAthlete(store(), NOW),
  });
  const routing = createRoutingPort({
    ...sealing,
    zones: () => Promise.resolve(options.zones ?? []),
  });
  return { instance, routing, storage };
}

async function connected(
  send: InstanceSend,
  w: IdentityInstance,
  options: { loadedFrom?: LoadedFrom; zones?: readonly PrivacyZoneRecord[] } = {},
) {
  const on = await device(send, options);
  const card = (await w.instanceKeys.show()).card;
  expect(await on.instance.connect(testing.TEST_ORIGIN, 'Anna', card)).toMatchObject({
    kind: 'connected',
  });
  return on;
}

/** A two-waypoint draft, its one leg waiting for roads. */
function oneLeg(from = A, to = B) {
  const first = addWaypoint(emptyDraft(), from).draft;
  return addWaypoint(first, to);
}

async function refusalOf(promise: Promise<unknown>): Promise<RoutingError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RoutingError) return error;
    throw error;
  }
  throw new Error('no refusal');
}

/** A number written with three or more decimal places: how a coordinate reads. */
const COORDINATE_LIKE = /\d+\.\d{3,}/;

describe('the route planner’s roads, from the rider’s instance (#2008)', () => {
  it('snaps a drawn leg to the instance’s roads, sealed, and the planner reads it back', async () => {
    const { w, send, seen, valhalla } = await world();
    const { routing } = await connected(send, w);
    expect(routing.offered()).toBe(true);

    const edit = oneLeg();
    const resolved = await resolveDraft(edit.draft, edit.stale, routing, RIDING_DEFAULTS);
    const [leg] = resolved.legs;
    expect(leg?.state).toBe('routed');
    // Snapped: the engine's line, not a straight one between the two pins.
    expect(leg?.state === 'routed' && leg.shape.length).toBe(valhallaTesting.FAKE_VERTICES);
    expect(leg?.state === 'routed' && (leg.distance as number)).toBeGreaterThan(1000);
    expect(leg?.state === 'routed' && leg.surface).toBe('paved');
    // The engine was asked in the rider's own words, translated by the instance.
    const asked = valhalla.requests.find((each) => each.action === 'route');
    expect(asked?.body.costing_options).toEqual({
      bicycle: { bicycle_type: 'road', use_hills: 0.25, avoid_bad_surfaces: 0.25 },
    });
    // Every call went out sealed: no routing path is on the wire.
    expect(seen.some((each) => each.includes('/v1/routing/'))).toBe(false);
  });

  it('gives the planner the climbing along the roads, a hole kept as a hole, and names its source', async () => {
    const { w, send } = await world({ heights: [10, null, 14] });
    const { routing } = await connected(send, w);
    const edit = oneLeg();
    const resolved = await resolveDraft(edit.draft, edit.stale, routing, RIDING_DEFAULTS);
    const planned = await planElevation(resolved, routing);
    expect(planned?.dataset).toEqual({ name: 'Tilezen terrain tiles', resolution: 30 });
    // A hole in the terrain data is a gap the screen draws, not a zero.
    expect(planned?.coverage.complete).toBe(false);
    expect(planned?.coverage.gaps.length).toBeGreaterThan(0);
    expect(planned?.profile.totalDistance as number).toBeGreaterThan(1000);
  });

  it('sends nothing for a leg that starts in a privacy zone, and says why without the place', async () => {
    const { w, send, seen, valhalla } = await world();
    const { routing } = await connected(send, w, { zones: [zoneAround(A)] });
    const sent = seen.length;
    const refused = await refusalOf(
      routing.route({
        waypoints: [{ position: A }, { position: B }],
        preferences: RIDING_DEFAULTS,
      }),
    );
    expect(refused.code).toBe('no-route');
    expect(refused.message).toBe(ZONE_REFUSAL);
    expect(seen).toHaveLength(sent);
    expect(valhalla.requests).toHaveLength(0);
    // Heights along a line through the zone are not asked for either.
    await refusalOf(routing.heights({ shape: [B, A], interval: metres(30) }));
    expect(seen).toHaveLength(sent);
    // The control: a leg clear of the zone is routed.
    const clear = await routing.route({
      waypoints: [{ position: B }, { position: at(0.03, 0.01) }],
      preferences: RIDING_DEFAULTS,
    });
    expect(clear).toHaveLength(1);
  });

  it('counts a zone out to its radius widened by the trim’s whole jitter', async () => {
    const { w, send, valhalla } = await world();
    // 210 m from the zone's centre: past its 200 m radius, inside 200 m × 1.125.
    const centre = at(0.0119, 0.01);
    const { routing } = await connected(send, w, { zones: [zoneAround(centre)] });
    const refused = await refusalOf(
      routing.route({
        waypoints: [{ position: A }, { position: B }],
        preferences: RIDING_DEFAULTS,
      }),
    );
    expect(refused.message).toBe(ZONE_REFUSAL);
    expect(valhalla.requests).toHaveLength(0);
  });

  it('says the instance has no routing engine, as a retryable leg and with no coordinate', async () => {
    const { w, send } = await world({ engine: 'none' });
    const { routing } = await connected(send, w);
    const refused = await refusalOf(
      routing.route({
        waypoints: [{ position: A }, { position: B }],
        preferences: RIDING_DEFAULTS,
      }),
    );
    expect(refused.code).toBe('unavailable');
    expect(refused.message).toMatch(/no routing engine/);
    expect(refused.message).not.toMatch(COORDINATE_LIKE);
  });

  it('turns the engine’s no-route into the planner’s, never quoting what it said', async () => {
    const { w, send, valhalla } = await world();
    const { routing } = await connected(send, w);
    valhalla.failNext('route', 400, {
      error_code: 442,
      error: 'No path could be found for input near 0.010000,0.010000',
    });
    const edit = oneLeg();
    const resolved = await resolveDraft(edit.draft, edit.stale, routing, RIDING_DEFAULTS);
    const [leg] = resolved.legs;
    expect(leg?.state).toBe('failed');
    const failure = leg?.state === 'failed' ? leg.failure : undefined;
    expect(failure?.retryable).toBe(false);
    expect(failure?.message).not.toMatch(COORDINATE_LIKE);
  });
});

describe('a device that cannot ask an instance offers no roads (ADR 0036 D-3)', () => {
  it('is not offered with no instance, and sends nothing', async () => {
    const { send, seen } = await world();
    const { routing } = await device(send);
    expect(routing.offered()).toBe(false);
    expect(seen).toEqual([]);
  });

  it('is not offered in a copy a website served, which seals nothing, and routes nothing', async () => {
    const { w, send, seen, valhalla } = await world();
    const anna = await connected(send, w);
    expect(anna.routing.offered()).toBe(true);
    // The same sign-in, held by a copy of the app a website served.
    const website = await device(send, { loadedFrom: LOADED_FROM_A_WEBSITE });
    for (const key of [INSTANCE_ACCOUNT_STORAGE_KEY, INSTANCE_SESSION_STORAGE_KEY]) {
      const value = anna.storage.getItem(key);
      if (value !== null) website.storage.setItem(key, value);
    }
    seen.length = 0;
    expect(website.routing.offered()).toBe(false);
    const refused = await refusalOf(
      website.routing.route({
        waypoints: [{ position: A }, { position: B }],
        preferences: RIDING_DEFAULTS,
      }),
    );
    expect(refused.code).toBe('unavailable');
    expect(seen).toEqual([]);
    expect(valhalla.requests).toHaveLength(0);
  });
});
