// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the sync tests share: activity files from `packages/fit`'s synthetic
 * corpus (#29), records signed by a real device key, and a signed-in world.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

import { readFileSync } from 'node:fs';

import {
  contentHashOf,
  signActivityRecord,
  type ActivityClaims,
  type SignedActivityRecord,
} from '@onyourleft/domain';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from '../auth/identity-testing.ts';
import { sha256Bytes, toBase64 } from './sync.ts';

const CORPUS = new URL('../../../../packages/fit/fixtures/corpus/', import.meta.url);

/** A file from the #29 corpus, by name. */
export function corpusFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, CORPUS)));
}

/** Claims a device would sign for a ride. No coordinate: the type has none. */
export function claimsFor(
  activityId: string,
  overrides: Partial<ActivityClaims> = {},
): ActivityClaims {
  return {
    activityId,
    name: `Ride ${activityId}`,
    startedAt: 1_790_000_000,
    startedAtTimeZone: 'Europe/London',
    elapsedTime: 3600,
    movingTime: 3500,
    distance: 30_000,
    hasPosition: true,
    ...overrides,
  };
}

/** A record `device` signed of `bytes`. */
export async function signedRecordOf(
  device: TestDevice,
  bytes: Uint8Array,
  activityId = 'ride-1',
): Promise<SignedActivityRecord> {
  return signActivityRecord(
    { claims: claimsFor(activityId), contentHash: await contentHashOf(bytes, sha256Bytes) },
    device.signingKey,
  );
}

/** The body `POST /v1/sync/records` takes. */
export async function uploadBody(
  device: TestDevice,
  bytes: Uint8Array,
  activityId = 'ride-1',
): Promise<{ record: SignedActivityRecord; file: string }> {
  return { record: await signedRecordOf(device, bytes, activityId), file: toBase64(bytes) };
}

/**
 * A GPX 1.1 track of `seconds` one-second points, with power, heart rate and
 * cadence in the Garmin extension — a long ride built from arithmetic, for a
 * budget measured on something the size of a real one.
 */
export function longGpx(seconds: number): Uint8Array {
  const points: string[] = [];
  for (let second = 0; second < seconds; second += 1) {
    const at = new Date((1_790_000_000 + second) * 1000).toISOString().replace('.000Z', 'Z');
    const lat = (51.5 + second * 0.00001).toFixed(6);
    points.push(
      `<trkpt lat="${lat}" lon="-0.120000"><ele>${(20 + (second % 50)).toString()}</ele><time>${at}</time>` +
        `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${(120 + (second % 30)).toString()}</gpxtpx:hr>` +
        `<gpxtpx:cad>${(85 + (second % 10)).toString()}</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`,
    );
  }
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" ` +
      `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">` +
      `<trk><name>Long</name><trkseg>${points.join('')}</trkseg></trk></gpx>`,
  );
}

/** A world with `count` signed-in devices, each its own athlete. */
export async function syncWorld(
  count: number,
  options: Parameters<typeof startIdentityInstance>[0] = {},
): Promise<{
  world: IdentityInstance;
  riders: { device: TestDevice; token: string; athleteId: string }[];
}> {
  // Room for a real activity file; the tests of the limit itself set their own.
  const world = await startIdentityInstance({ bodyLimitBytes: 256 * 1024, ...options });
  const riders = [];
  for (let index = 0; index < count; index += 1) {
    const device = await testDevice();
    const session = await world.signIn(device);
    riders.push({
      device,
      token: session.body.sessionToken as string,
      athleteId: session.body.athleteId as string,
    });
  }
  return { world, riders };
}

/**
 * A successful call of every sync route, for `openapi.test.ts`'s "every route
 * answers with the shape its entry declares".
 */
export const SYNC_HAPPY_CALLS: Readonly<
  Record<string, (world: IdentityInstance) => Promise<Response>>
> = {
  ingestRecord: async (world) => {
    const { token, device } = await signedInRider(world);
    return authorised(
      world,
      token,
      'POST',
      '/v1/sync/records',
      await uploadBody(device, NOMINAL()),
    );
  },
  getOriginalFile: async (world) => {
    const { token, content } = await riderWithRide(world);
    return authorised(world, token, 'GET', `/v1/sync/files/${content}`);
  },
};

const NOMINAL = (): Uint8Array => corpusFile('nominal-ride.gpx');

async function signedInRider(world: IdentityInstance) {
  const device = await testDevice();
  const session = await world.signIn(device);
  return { device, token: session.body.sessionToken as string };
}

/** A signed-in rider who has synced one ride, and its content hash. */
export async function riderWithRide(world: IdentityInstance) {
  const rider = await signedInRider(world);
  const answer = await authorised(
    world,
    rider.token,
    'POST',
    '/v1/sync/records',
    await uploadBody(rider.device, NOMINAL()),
  );
  const { contentSha256 } = (await answer.json()) as { contentSha256: string };
  return { ...rider, content: contentSha256 };
}

/** A request with the session token, and a JSON body when there is one. */
export function authorised(
  world: IdentityInstance,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${world.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
