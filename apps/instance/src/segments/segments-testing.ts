// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the segment tests share (#68): a definition, a rider with a synced and
 * shared ride, and a successful call of every segment route for
 * `openapi.test.ts`.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

import type { PublishedSegmentDefinition } from '@onyourleft/domain';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { authorised, riderWithRide } from '../sync/sync-testing.ts';

/** When the ride every test rider syncs started (`sync-testing.ts` §`claimsFor`). */
export const RIDE_STARTED_AT = 1_790_000_000;

/** A northbound path of six positions a little over 110 m apart: about 555 m. */
export function definitionFixture(name = 'Box Hill'): PublishedSegmentDefinition {
  return {
    name,
    sport: 'ride',
    geometry: Array.from({ length: 6 }, (_, index) => [51.5 + index * 0.001, -0.12] as const),
    endpointRadiusMetres: 15,
    bearingToleranceDegrees: 60,
  };
}

/** Publish `definition` as `token`'s rider; answers the segment's id. */
export async function publish(
  world: IdentityInstance,
  token: string,
  definition: PublishedSegmentDefinition = definitionFixture(),
): Promise<string> {
  const answer = await world.call('POST', '/v1/segments', { token, body: { segment: definition } });
  if (answer.status !== 200) throw new Error(`publish answered ${String(answer.status)}`);
  return (answer.body as { segmentId: string }).segmentId;
}

/** A rider whose synced ride is public here, and one effort of it shared on `segmentId`. */
export async function riderWithSharedEffort(
  world: IdentityInstance,
  segmentId: string,
  elapsedSeconds = 300,
) {
  const rider = await riderWithRide(world);
  await authorised(world, rider.token, 'POST', `/v1/sync/records/${rider.content}/visibility`, {
    visibility: 'public',
  });
  await authorised(
    world,
    rider.token,
    'POST',
    `/v1/segments/${segmentId}/efforts/${rider.content}`,
    {
      efforts: [{ startedAt: RIDE_STARTED_AT + 60, elapsedSeconds, visibility: 'public' }],
    },
  );
  return rider;
}

/** A successful call of every segment route, and of the ride visibility route. */
export const SEGMENT_HAPPY_CALLS: Readonly<
  Record<string, (world: IdentityInstance) => Promise<Response>>
> = {
  setActivityVisibility: async (world) => {
    const { token, content } = await riderWithRide(world);
    return authorised(world, token, 'POST', `/v1/sync/records/${content}/visibility`, {
      visibility: 'public',
    });
  },
  publishSegment: async (world) => {
    const { token } = await riderWithRide(world);
    return authorised(world, token, 'POST', '/v1/segments', {
      segment: definitionFixture('Published for the specification'),
    });
  },
  listSegments: async (world) => {
    const { token } = await riderWithRide(world);
    await publish(world, token, definitionFixture('Listed for the specification'));
    return authorised(world, token, 'GET', '/v1/segments');
  },
  getSegment: async (world) => {
    const { token } = await riderWithRide(world);
    const segmentId = await publish(world, token, definitionFixture('Read for the specification'));
    return authorised(world, token, 'GET', `/v1/segments/${segmentId}`);
  },
  withdrawSegment: async (world) => {
    const { token } = await riderWithRide(world);
    const segmentId = await publish(world, token, definitionFixture('Withdrawn for the spec'));
    return authorised(world, token, 'DELETE', `/v1/segments/${segmentId}`);
  },
  shareSegmentEfforts: async (world) => {
    const { token, content } = await riderWithRide(world);
    const segmentId = await publish(world, token, definitionFixture('Shared on for the spec'));
    return authorised(world, token, 'POST', `/v1/segments/${segmentId}/efforts/${content}`, {
      efforts: [{ startedAt: RIDE_STARTED_AT + 60, elapsedSeconds: 300, visibility: 'public' }],
    });
  },
  getSegmentLeaderboard: async (world) => {
    const { token } = await riderWithRide(world);
    const segmentId = await publish(world, token, definitionFixture('Ranked for the spec'));
    await riderWithSharedEffort(world, segmentId);
    return authorised(world, token, 'GET', `/v1/segments/${segmentId}/leaderboard`);
  },
};
