// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Cross-athlete leaderboards on an instance, held to every one of #68's
 * criteria** — through the routes a device calls, sealed, and read back the
 * way a device reads them.
 *
 * ⚠️ **Three athletes at least, every time it is about who is on a board.**
 * One athlete proves nothing about scoping, and two cannot tell "everybody but
 * C's private ride" from "everybody A is connected to" (#34's revision).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { contentHashOf, signActivityRecord, type ActivityClaims } from '@onyourleft/domain';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from '../auth/identity-testing.ts';
import { openDatabase } from '../store/node-sqlite.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SqlStore } from '../store/sql-store.ts';
import {
  activityRecordFixture,
  createStoreHarness,
  registrationFixture,
  type StoreHarness,
} from '../store/testing/index.ts';
import type { Caller } from '../auth/identity.ts';
import { claimsFor, longGpx } from '../sync/sync-testing.ts';
import { sha256Bytes, toBase64 } from '../sync/sync.ts';
import { definitionFixture, publish, RIDE_STARTED_AT } from './segments-testing.ts';
import { BOARD_PERIODS, BOARD_ROWS, BOARD_SCOPES, createSegments, type Board } from './segments.ts';

interface Rider {
  readonly device: TestDevice;
  readonly token: string;
  readonly athleteId: string;
  readonly recoveryCodes: string[];
  readonly name: string;
}

let world: IdentityInstance;
/** A different file for every ride any rider here syncs: one rider's two rides are two contents. */
let rideSeconds = 60;

beforeAll(async () => {
  world = await startIdentityInstance({ bodyLimitBytes: 256 * 1024 });
});
afterAll(() => world.close());

async function rider(name: string): Promise<Rider> {
  const device = await testDevice();
  const session = await world.signIn(device, { displayName: name });
  if (session.status !== 200) throw new Error(`sign-in answered ${String(session.status)}`);
  return {
    device,
    token: session.body.sessionToken as string,
    athleteId: session.body.athleteId as string,
    recoveryCodes: session.body.recoveryCodes as string[],
    name,
  };
}

/** Sync a ride of `who`'s, its record claiming `claims`; answers its content hash. */
async function ride(
  who: Rider,
  claims: Partial<ActivityClaims> = {},
  /** The file’s length in seconds, under 61 so no other ride here has it: the same for two riders is one file. */
  length?: number,
): Promise<string> {
  rideSeconds += 1;
  const bytes = longGpx(length ?? rideSeconds);
  const record = await signActivityRecord(
    {
      claims: claimsFor(`ride-${String(rideSeconds)}`, claims),
      contentHash: await contentHashOf(bytes, sha256Bytes),
    },
    who.device.signingKey,
  );
  const answer = await world.call('POST', '/v1/sync/records', {
    token: who.token,
    body: { record, file: toBase64(bytes) },
  });
  if (answer.status !== 200) throw new Error(JSON.stringify(answer.body));
  return (answer.body as { contentSha256: string }).contentSha256;
}

async function visibility(who: Rider, content: string, value: string) {
  return world.call('POST', `/v1/sync/records/${content}/visibility`, {
    token: who.token,
    body: { visibility: value },
  });
}

async function share(
  who: Rider,
  segmentId: string,
  content: string,
  efforts: readonly {
    startedAt?: number;
    elapsedSeconds: number;
    visibility?: 'public' | 'private-match';
  }[],
) {
  return world.call('POST', `/v1/segments/${segmentId}/efforts/${content}`, {
    token: who.token,
    body: {
      efforts: efforts.map((effort, index) => ({
        startedAt: effort.startedAt ?? RIDE_STARTED_AT + 60 + index * 600,
        elapsedSeconds: effort.elapsedSeconds,
        visibility: effort.visibility ?? 'public',
      })),
    },
  });
}

/** A rider with a public ride and one public effort of it on `segmentId`. */
async function onTheBoard(name: string, segmentId: string, elapsedSeconds: number) {
  const who = await rider(name);
  const content = await ride(who);
  expect((await visibility(who, content, 'public')).status).toBe(200);
  expect((await share(who, segmentId, content, [{ elapsedSeconds }])).status).toBe(200);
  return { ...who, content };
}

async function board(who: Rider, segmentId: string, query = ''): Promise<Board> {
  const answer = await world.call('GET', `/v1/segments/${segmentId}/leaderboard${query}`, {
    token: who.token,
  });
  if (answer.status !== 200) throw new Error(JSON.stringify(answer.body));
  return answer.body as Board;
}

const names = (shown: Board): string[] => shown.rows.map((row) => row.rider);

/** A row as a rider reads it: the effort's opaque id and the exclusion are #69's. */
const shown = (row: Board['rows'][number]) => ({
  rank: row.rank,
  rider: row.rider,
  yours: row.yours,
  elapsedSeconds: row.elapsedSeconds,
});

let segmentNumber = 0;
/** A segment of its own for each test, published by `who`. */
async function segmentBy(who: Rider): Promise<string> {
  segmentNumber += 1;
  return publish(world, who.token, definitionFixture(`Climb ${String(segmentNumber)}`));
}

describe('who is on a board (#68’s first and second criteria)', () => {
  it('shows athlete A the riders whose public rides they may see — and never athlete C’s private ride', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const annRide = await ride(ann);
    await visibility(ann, annRide, 'public');
    await share(ann, segmentId, annRide, [{ elapsedSeconds: 320 }]);
    await onTheBoard('Bea', segmentId, 300);
    // Cy shares an effort from a ride that is private here: the default.
    const cy = await rider('Cy');
    const cyRide = await ride(cy);
    expect((await share(cy, segmentId, cyRide, [{ elapsedSeconds: 200 }])).status).toBe(200);

    const seen = await board(ann, segmentId);
    expect(seen.scope).toBe('instance');
    expect(names(seen)).toEqual(['Bea', 'Ann']);
    expect(seen.rows.map((row) => row.yours)).toEqual([false, true]);
    expect(seen.rows.map((row) => row.rank)).toEqual([1, 2]);
    // Cy's effort is stored — her own board has it — and on nobody else's.
    expect(names(await board(cy, segmentId, '?scope=personal'))).toEqual(['Cy']);
    expect(names(await board(cy, segmentId))).toEqual(['Bea', 'Ann']);

    // The control: once Cy makes the ride public, the same effort is there, first.
    await visibility(cy, cyRide, 'public');
    expect(names(await board(ann, segmentId))).toEqual(['Cy', 'Bea', 'Ann']);
    // And private again takes it off on the next read.
    await visibility(cy, cyRide, 'private');
    expect(names(await board(ann, segmentId))).toEqual(['Bea', 'Ann']);
  });

  it('makes public only the caller’s own record of a file two riders sent (#776)', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    // The same bytes, synced by both: one content hash, two records.
    const annRide = await ride(ann, {}, 30);
    const bea = await rider('Bea');
    const beaRide = await ride(bea, {}, 30);
    expect(beaRide).toBe(annRide);
    await share(ann, segmentId, annRide, [{ elapsedSeconds: 250 }]);
    expect((await visibility(bea, beaRide, 'public')).status).toBe(200);
    // Ann's record is still private: her effort is on nobody's board.
    const cy = await rider('Cy');
    expect(names(await board(cy, segmentId))).toEqual([]);
    const exported = (await world.call('GET', '/v1/account/export', { token: ann.token })).body as {
      activities: { visibility: string }[];
    };
    expect(exported.activities.map((each) => each.visibility)).toEqual(['private']);
    // And a file the caller never sent is `not_found`, as for nobody.
    const dee = await rider('Dee');
    expect((await visibility(dee, annRide, 'public')).status).toBe(404);
  });

  it('never ranks a `followers` ride on a shared board: there is no follow to scope it by', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    await onTheBoard('Bea', segmentId, 300);
    const cy = await rider('Cy');
    const cyRide = await ride(cy);
    await visibility(cy, cyRide, 'followers');
    await share(cy, segmentId, cyRide, [{ elapsedSeconds: 200 }]);
    expect(names(await board(ann, segmentId))).toEqual(['Bea']);
  });

  it('never ranks a `private-match` effort on a shared board, even from a public ride — its rider still sees it', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    await onTheBoard('Bea', segmentId, 300);
    // Cy's ride IS public here; this effort ended in one of her privacy zones.
    const cy = await rider('Cy');
    const cyRide = await ride(cy);
    await visibility(cy, cyRide, 'public');
    await share(cy, segmentId, cyRide, [{ elapsedSeconds: 200, visibility: 'private-match' }]);

    expect(names(await board(ann, segmentId))).toEqual(['Bea']);
    expect(names(await board(cy, segmentId))).toEqual(['Bea']);
    const own = await board(cy, segmentId, '?scope=personal');
    expect(own.scope).toBe('personal');
    expect(own.rows.map(shown)).toEqual([
      { rank: 1, rider: 'Cy', yours: true, elapsedSeconds: 200 },
    ]);

    // The control: the same effort shared `public` is ranked.
    await share(cy, segmentId, cyRide, [{ elapsedSeconds: 200, visibility: 'public' }]);
    expect(names(await board(ann, segmentId))).toEqual(['Cy', 'Bea']);
  });

  it('ranks each rider once, by their best, fastest first, a tie to the earlier start', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await rider('Bea');
    const beaRide = await ride(bea);
    await visibility(bea, beaRide, 'public');
    // Two laps of it in one ride: the second is her best.
    await share(bea, segmentId, beaRide, [{ elapsedSeconds: 330 }, { elapsedSeconds: 290 }]);
    const cy = await rider('Cy');
    const cyRide = await ride(cy);
    await visibility(cy, cyRide, 'public');
    // Level with Bea's best, started a minute earlier in the day than hers.
    await share(cy, segmentId, cyRide, [{ startedAt: RIDE_STARTED_AT + 600, elapsedSeconds: 290 }]);

    const seen = await board(ann, segmentId);
    expect(seen.rows.map(shown)).toEqual([
      { rank: 1, rider: 'Cy', yours: false, elapsedSeconds: 290 },
      { rank: 2, rider: 'Bea', yours: false, elapsedSeconds: 290 },
    ]);
    expect(seen.rankedBy).toBe('elapsed');
    // Her own board lists both of her laps.
    expect(
      (await board(bea, segmentId, '?scope=personal')).rows.map((row) => row.elapsedSeconds),
    ).toEqual([290, 330]);
  });

  it('shows a name a moderator hid as “Rider”, through the one public projection', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea Hidden', segmentId, 300);
    const database = openDatabase(world.path);
    try {
      database
        .prepare('UPDATE athlete SET display_name_hidden_at = 1 WHERE id = ?')
        .run(bea.athleteId);
    } finally {
      database.close();
    }
    expect(names(await board(ann, segmentId))).toEqual(['Rider']);
  });
});

describe('the choke point, applied inside the one read (#68’s first criterion, #83)', () => {
  it('puts exactly the riders `canSee` lets the viewer see on the board, pair by pair', async () => {
    const viewer = await rider('Viewer');
    // Published by somebody else, so a rider who blocks the viewer can still read it.
    const publisher = await rider('Publisher');
    const segmentId = await segmentBy(publisher);
    const plain = await onTheBoard('Plain', segmentId, 300);
    const blocksViewer = await onTheBoard('Blocks viewer', segmentId, 301);
    const blockedByViewer = await onTheBoard('Blocked by viewer', segmentId, 302);
    const suspended = await onTheBoard('Suspended', segmentId, 303);
    const pending = await onTheBoard('Pending', segmentId, 304);
    const refused = await onTheBoard('Refused', segmentId, 305);
    const viewerRide = await ride(viewer);
    await visibility(viewer, viewerRide, 'public');
    await share(viewer, segmentId, viewerRide, [{ elapsedSeconds: 306 }]);

    expect(
      (await world.call('POST', `/v1/blocks/${viewer.athleteId}`, { token: blocksViewer.token }))
        .status,
    ).toBe(204);
    expect(
      (await world.call('POST', `/v1/blocks/${blockedByViewer.athleteId}`, { token: viewer.token }))
        .status,
    ).toBe(204);
    const database = openDatabase(world.path);
    try {
      database.prepare('UPDATE athlete SET suspended_at = 1 WHERE id = ?').run(suspended.athleteId);
      database
        .prepare("UPDATE athlete SET registration_state = 'pending' WHERE id = ?")
        .run(pending.athleteId);
      database
        .prepare("UPDATE athlete SET registration_state = 'refused' WHERE id = ?")
        .run(refused.athleteId);
    } finally {
      database.close();
    }

    const everybody = [plain, blocksViewer, blockedByViewer, suspended, pending, refused, viewer];
    const seen = names(await board(viewer, segmentId));
    for (const subject of everybody) {
      const canSee = await world.identity.moderation.canSee(viewer.athleteId, subject.athleteId);
      expect(seen.includes(subject.name), subject.name).toBe(canSee);
    }
    // And it is not vacuous: some are seen, some are not.
    expect(seen).toEqual(['Plain', 'Viewer']);
    // Either way round: the rider who blocked the viewer does not see them.
    expect(names(await board(blocksViewer, segmentId))).not.toContain('Viewer');
  });

  it('answers a segment whose publisher blocked the caller `not_found`, as one that is not there', async () => {
    const ann = await rider('Ann');
    const bea = await rider('Bea');
    const segmentId = await segmentBy(ann);
    await world.call('POST', `/v1/blocks/${bea.athleteId}`, { token: ann.token });
    const blocked = await world.call('GET', `/v1/segments/${segmentId}`, { token: bea.token });
    const nobody = await world.call('GET', `/v1/segments/${'0'.repeat(32)}`, { token: bea.token });
    expect(blocked).toEqual(nobody);
    expect(blocked.status).toBe(404);
    const listed = await world.call('GET', '/v1/segments?limit=200', { token: bea.token });
    expect(
      (listed.body as { items: { segmentId: string }[] }).items.map((each) => each.segmentId),
    ).not.toContain(segmentId);
    // The control: an unrelated rider reads it.
    const cy = await rider('Cy');
    expect((await world.call('GET', `/v1/segments/${segmentId}`, { token: cy.token })).status).toBe(
      200,
    );
  });
});

describe('a rolling window (#68’s fifth criterion)', () => {
  it('leaves out an effort recorded before the segment was published here; all-time keeps it', async () => {
    const ann = await rider('Ann');
    // A ride from before the segment existed, then the segment, two hours on.
    const bea = await rider('Bea');
    const before = await ride(bea);
    await visibility(bea, before, 'public');
    world.clock.ms = Math.max(world.clock.ms, (RIDE_STARTED_AT + 7_200) * 1000);
    const segmentId = await segmentBy(ann);
    const published = (
      (await world.call('GET', `/v1/segments/${segmentId}`, { token: ann.token })).body as {
        createdAt: number;
      }
    ).createdAt;
    expect(published).toBeGreaterThan(RIDE_STARTED_AT + 3_600);
    await share(bea, segmentId, before, [{ elapsedSeconds: 250 }]);
    // Cy rode it after it was published.
    const cy = await rider('Cy');
    const after = await ride(cy, { startedAt: published + 60 });
    await visibility(cy, after, 'public');
    await share(cy, segmentId, after, [{ startedAt: published + 120, elapsedSeconds: 280 }]);

    for (const period of ['last-90-days', 'last-30-days']) {
      const rolling = await board(ann, segmentId, `?period=${period}`);
      expect(rolling.period).toBe(period);
      expect(names(rolling), period).toEqual(['Cy']);
    }
    expect(names(await board(ann, segmentId, '?period=all-time'))).toEqual(['Bea', 'Cy']);
    // The rider's own rolling board holds to the same rule.
    expect((await board(bea, segmentId, '?scope=personal&period=last-90-days')).rows).toEqual([]);
  });

  it('leaves out an effort older than the window, ridden after the segment was published', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const published = Math.floor(world.clock.ms / 1000);
    // Forty days on (a session lasts less: everybody signs in afresh), Bea
    // shares a ride from the day after the segment was published.
    world.clock.ms += 40 * 86_400_000;
    const dee = await rider('Dee');
    const bea = await rider('Bea');
    const content = await ride(bea, { startedAt: published + 86_400 });
    await visibility(bea, content, 'public');
    await share(bea, segmentId, content, [{ startedAt: published + 86_460, elapsedSeconds: 300 }]);
    expect(names(await board(dee, segmentId, '?period=last-30-days'))).toEqual([]);
    expect(names(await board(dee, segmentId, '?period=last-90-days'))).toEqual(['Bea']);
    expect(names(await board(dee, segmentId, '?period=all-time'))).toEqual(['Bea']);
  });

  it('refuses a scope or a period it does not offer, naming it', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    for (const [query, field] of [
      ['?scope=following', 'scope'],
      ['?scope=club', 'scope'],
      ['?scope=instance&scope=personal', 'scope'],
      ['?period=all-instances', 'period'],
    ] as const) {
      const answer = await world.call('GET', `/v1/segments/${segmentId}/leaderboard${query}`, {
        token: ann.token,
      });
      expect(answer.status, query).toBe(400);
      expect(JSON.stringify(answer.body), query).toContain(`"field":"${field}"`);
    }
  });
});

describe('what a board says, read off the raw body (#68’s sixth criterion)', () => {
  it('carries no coordinate, date, ride or athlete id of anybody', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const response = await world.request('GET', `/v1/segments/${segmentId}/leaderboard`, {
      token: ann.token,
    });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain('"rider":"Bea"');
    // The ride's track (`longGpx`: 51.5…, -0.12) and the segment's path.
    expect(raw).not.toMatch(/51\.5|-0\.12|latitude|longitude|geometry|position/);
    expect(raw).not.toContain(bea.athleteId);
    expect(raw).not.toContain(ann.athleteId);
    expect(raw).not.toContain(bea.content);
    expect(raw).not.toContain(String(RIDE_STARTED_AT));
    expect(raw).not.toMatch(/startedAt|definition/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('an erased account (#68’s seventh criterion, decided by #35: its rows go)', () => {
  it('takes the rider’s rows off every board, and the publisher’s segment with every effort on it', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const cy = await onTheBoard('Cy', segmentId, 310);
    const elsewhere = await segmentBy(cy);
    await share(bea, elsewhere, bea.content, [{ elapsedSeconds: 200 }]);
    expect(names(await board(ann, segmentId))).toEqual(['Bea', 'Cy']);

    const erased = await world.call('DELETE', '/v1/account', {
      token: bea.token,
      body: { recoveryCode: bea.recoveryCodes[0] },
    });
    expect(erased.status, JSON.stringify(erased.body)).toBe(204);
    expect(names(await board(ann, segmentId))).toEqual(['Cy']);
    expect(names(await board(cy, elsewhere))).toEqual([]);

    // The publisher goes: the segment, and Cy's effort on it with it.
    const erasedAnn = await world.call('DELETE', '/v1/account', {
      token: ann.token,
      body: { recoveryCode: ann.recoveryCodes[0] },
    });
    expect(erasedAnn.status).toBe(204);
    expect(
      (await world.call('GET', `/v1/segments/${segmentId}/leaderboard`, { token: cy.token }))
        .status,
    ).toBe(404);
    const database = openDatabase(world.path);
    try {
      const left = database
        .prepare('SELECT count(*) AS n FROM segment_effort WHERE segment_id = ?')
        .get(segmentId) as { n: number };
      expect(left.n).toBe(0);
    } finally {
      database.close();
    }
  });

  it('withdraws a segment only for its publisher, and every effort on it with it', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const refused = await world.call('DELETE', `/v1/segments/${segmentId}`, { token: bea.token });
    expect(refused.status).toBe(404);
    expect(names(await board(ann, segmentId))).toEqual(['Bea']);
    expect(
      (await world.call('DELETE', `/v1/segments/${segmentId}`, { token: ann.token })).status,
    ).toBe(204);
    expect(
      (await world.call('GET', `/v1/segments/${segmentId}`, { token: bea.token })).status,
    ).toBe(404);
    // Bea's effort went with it, read off the database rather than off a board
    // that could not show it anyway; her own export no longer names it.
    expect(effortsOn(segmentId)).toBe(0);
    const exported = (await world.call('GET', '/v1/account/export', { token: bea.token })).body as {
      segmentEfforts: unknown[];
    };
    expect(exported.segmentEfforts).toEqual([]);
  });
});

/** How many efforts the database holds on a segment, anybody's. */
function effortsOn(segmentId: string): number {
  const database = openDatabase(world.path);
  try {
    return (
      database
        .prepare('SELECT count(*) AS n FROM segment_effort WHERE segment_id = ?')
        .get(segmentId) as { n: number }
    ).n;
  } finally {
    database.close();
  }
}

describe('sharing an effort', () => {
  it('answers a ride’s visibility with what it was before, so a device can put it back', async () => {
    const ann = await rider('Ann');
    const content = await ride(ann);
    expect((await visibility(ann, content, 'public')).body).toEqual({
      visibility: 'public',
      previous: 'private',
    });
    expect((await visibility(ann, content, 'followers')).body).toEqual({
      visibility: 'followers',
      previous: 'public',
    });
    // Another rider's ride is none of theirs: not found, and unchanged.
    const bea = await rider('Bea');
    expect((await visibility(bea, content, 'private')).status).toBe(404);
    expect((await visibility(ann, content, 'private')).body).toEqual({
      visibility: 'private',
      previous: 'followers',
    });
  });

  it('only from the caller’s own synced ride: another rider’s file is `not_found`', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const cy = await rider('Cy');
    const taken = await share(cy, segmentId, bea.content, [{ elapsedSeconds: 1 }]);
    expect(taken.status).toBe(404);
    expect(names(await board(ann, segmentId))).toEqual(['Bea']);
  });

  it('only within the ride’s recorded time, and only from a ride with a position', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const content = await ride(ann);
    for (const effort of [
      { startedAt: RIDE_STARTED_AT - 1, elapsedSeconds: 60 },
      { startedAt: RIDE_STARTED_AT + 3_590, elapsedSeconds: 60 },
    ]) {
      const answer = await share(ann, segmentId, content, [effort]);
      expect(answer.status).toBe(400);
      expect(JSON.stringify(answer.body)).toContain('recorded time');
    }
    // The control: at its last second, within the slack.
    expect(
      (
        await share(ann, segmentId, content, [
          { startedAt: RIDE_STARTED_AT + 3_540, elapsedSeconds: 61 },
        ])
      ).status,
    ).toBe(200);
    const indoor = await ride(ann, { hasPosition: false });
    const answer = await share(ann, segmentId, indoor, [{ elapsedSeconds: 60 }]);
    expect(answer.status).toBe(400);
    expect(JSON.stringify(answer.body)).toContain('no position');
  });

  it('replaces what the ride shared before, and none withdraws it', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    await share(bea, segmentId, bea.content, [{ elapsedSeconds: 280 }]);
    expect(
      (await board(bea, segmentId, '?scope=personal')).rows.map((row) => row.elapsedSeconds),
    ).toEqual([280]);
    expect((await share(bea, segmentId, bea.content, [])).status).toBe(200);
    expect(names(await board(ann, segmentId))).toEqual([]);
  });

  it('refuses a malformed list, naming the field', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const content = await ride(ann);
    for (const efforts of [
      'one',
      Array.from({ length: 21 }, (_, index) => ({
        startedAt: RIDE_STARTED_AT + index,
        elapsedSeconds: 1,
        visibility: 'public',
      })),
      [{ startedAt: RIDE_STARTED_AT, elapsedSeconds: 0, visibility: 'public' }],
      [{ startedAt: RIDE_STARTED_AT, elapsedSeconds: 10, visibility: 'excluded' }],
      [{ startedAt: RIDE_STARTED_AT + 0.5, elapsedSeconds: 10, visibility: 'public' }],
      [
        { startedAt: RIDE_STARTED_AT, elapsedSeconds: 10, visibility: 'public' },
        { startedAt: RIDE_STARTED_AT, elapsedSeconds: 11, visibility: 'public' },
      ],
      [{ startedAt: RIDE_STARTED_AT, elapsedSeconds: 10, visibility: 'public', athleteId: 'x' }],
    ]) {
      const answer = await world.call('POST', `/v1/segments/${segmentId}/efforts/${content}`, {
        token: ann.token,
        body: { efforts },
      });
      expect(answer.status, JSON.stringify(efforts).slice(0, 80)).toBe(400);
      expect(JSON.stringify(answer.body)).toContain('"field":"efforts"');
    }
  });
});

describe('publishing a segment', () => {
  it('names it by its definition: the same one twice is one segment, measured here', async () => {
    const ann = await rider('Ann');
    const bea = await rider('Bea');
    const definition = definitionFixture('Published twice');
    const first = await world.call('POST', '/v1/segments', {
      token: ann.token,
      body: { segment: definition },
    });
    const again = await world.call('POST', '/v1/segments', {
      token: bea.token,
      body: { segment: definition },
    });
    const one = first.body as { segmentId: string; published: boolean; createdAt: number };
    const two = again.body as { segmentId: string; published: boolean; createdAt: number };
    expect(one.published).toBe(true);
    expect(two).toEqual({ ...one, published: false });
    const read = (await world.call('GET', `/v1/segments/${one.segmentId}`, { token: bea.token }))
      .body as { distanceMetres: number; yours: boolean; definition: unknown };
    expect(read.yours).toBe(false);
    expect(read.definition).toEqual(JSON.parse(JSON.stringify(definition)));
    expect(read.distanceMetres).toBeGreaterThan(550);
    expect(read.distanceMetres).toBeLessThan(560);
  });

  it('refuses a definition it cannot rank against, naming the field and never a coordinate', async () => {
    const ann = await rider('Ann');
    const short = { ...definitionFixture(), geometry: definitionFixture().geometry.slice(0, 3) };
    const offEarth = {
      ...definitionFixture(),
      geometry: [
        [91.234567, -0.12],
        [51.5, -0.12],
        [51.6, -0.12],
      ],
    };
    for (const segment of [short, offEarth, { ...definitionFixture(), distance: 10 }]) {
      const answer = await world.call('POST', '/v1/segments', {
        token: ann.token,
        body: { segment },
      });
      expect(answer.status).toBe(400);
      expect(JSON.stringify(answer.body)).not.toContain('91.23');
    }
  });

  it('lists the segments published here, newest first, a page at a time, with no path', async () => {
    const ann = await rider('Ann');
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      world.clock.ms += 1_000;
      ids.push(await publish(world, ann.token, definitionFixture(`Listed ${String(index)}`)));
    }
    const first = await world.call('GET', '/v1/segments?limit=2', { token: ann.token });
    const page = first.body as { items: { segmentId: string }[]; next: string | null };
    expect(page.items.map((each) => each.segmentId)).toEqual([ids[2], ids[1]]);
    expect(JSON.stringify(page)).not.toMatch(/geometry|51\.5/);
    const second = await world.call('GET', `/v1/segments?limit=2&cursor=${page.next ?? ''}`, {
      token: ann.token,
    });
    expect((second.body as { items: { segmentId: string }[] }).items[0]?.segmentId).toBe(ids[0]);
  });
});

describe('the account export (#35)', () => {
  it('carries the rider’s own segments, efforts and ride visibility — and nobody else’s', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const theirs = await segmentBy(bea);
    const annRide = await ride(ann);
    await share(ann, theirs, annRide, [{ elapsedSeconds: 250, visibility: 'private-match' }]);

    const exported = (await world.call('GET', '/v1/account/export', { token: ann.token })).body as {
      activities: { contentSha256: string; visibility: string }[];
      segments: { segmentId: string; definition: { name: string } }[];
      segmentEfforts: { segmentId: string; contentSha256: string; visibility: string }[];
    };
    expect(exported.segments.map((each) => each.segmentId)).toEqual([segmentId]);
    expect(exported.segments[0]?.definition.name).toMatch(/^Climb /);
    expect(exported.segmentEfforts).toEqual([
      {
        segmentId: theirs,
        contentSha256: annRide,
        startedAt: RIDE_STARTED_AT + 60,
        elapsedSeconds: 250,
        visibility: 'private-match',
      },
    ]);
    expect(exported.activities.map((each) => each.visibility)).toEqual(['private']);
    const beas = (await world.call('GET', '/v1/account/export', { token: bea.token })).body as {
      activities: { visibility: string }[];
      segmentEfforts: { segmentId: string }[];
    };
    expect(beas.activities.map((each) => each.visibility)).toEqual(['public']);
    expect(beas.segmentEfforts.map((each) => each.segmentId)).toEqual([segmentId]);
  });
});

describe('one statement a board, whatever its length (#68’s third and fourth criteria)', () => {
  let harness: StoreHarness;
  const SEGMENT = 'b'.repeat(32);
  const athletes = (count: number) =>
    Array.from({ length: count }, (_, index) => `athlete-${String(index).padStart(3, '0')}`);

  beforeAll(async () => {
    harness = await createStoreHarness();
    await harness.write(async (store) => {
      for (const athleteId of athletes(60)) {
        await store.registerAthlete(registrationFixture(athleteId));
        const ride = activityRecordFixture(athleteId);
        await store.putActivityRecord(ride);
        await store.setActivityVisibility(athleteId, ride.contentSha256, 'public');
      }
      await store.publishSegment('athlete-000', {
        id: SEGMENT,
        name: 'Counted',
        sport: 'ride',
        distanceMetres: 500,
        definition: '{}',
        createdAt: 1_789_000_000,
      });
    });
  });
  afterAll(() => harness.destroy());

  async function seed(count: number): Promise<void> {
    await harness.write(async (store) => {
      for (const [index, athleteId] of athletes(count).entries()) {
        await store.replaceSegmentEfforts(
          athleteId,
          SEGMENT,
          activityRecordFixture(athleteId).contentSha256,
          [
            {
              id: `e-${athleteId}-1`,
              startedAt: 1_790_000_000,
              elapsedSeconds: 300 + index,
              visibility: 'public',
              excludedReason: null,
            },
            {
              id: `e-${athleteId}-2`,
              startedAt: 1_790_000_600,
              elapsedSeconds: 400 + index,
              visibility: 'public',
              excludedReason: null,
            },
          ],
          1_790_000_700,
        );
      }
    });
  }

  async function counted<T>(
    read: (store: SqlStore) => Promise<T>,
  ): Promise<{ value: T; statements: string[] }> {
    const statements: string[] = [];
    const store = await openSqlStore(harness.path, { onQuery: (sql) => statements.push(sql) });
    // Opening checks the migrations: only what the read itself runs is counted.
    statements.length = 0;
    try {
      return { value: await read(store), statements };
    } finally {
      await store.close();
    }
  }

  const viewer: Caller = {
    athleteId: 'athlete-000',
    deviceKey: 'key-of-athlete-000',
    tokenSha256: '0'.repeat(64),
    standing: 'active',
  };

  it('issues the same number of statements for a board of three rows as for one of fifty', async () => {
    await seed(3);
    const small = await counted((store) =>
      createSegments({ store, now: () => 1_790_100_000_000 }).board(
        viewer,
        SEGMENT,
        new URLSearchParams(),
      ),
    );
    await seed(60);
    const large = await counted((store) =>
      createSegments({ store, now: () => 1_790_100_000_000 }).board(
        viewer,
        SEGMENT,
        new URLSearchParams(),
      ),
    );
    expect(small.value.ok && small.value.value.rows.length).toBe(3);
    expect(large.value.ok && large.value.value.rows.length).toBe(BOARD_ROWS);
    expect(large.statements.length).toBe(small.statements.length);
    expect(small.statements.length).toBeLessThanOrEqual(2);
  });

  it('answers every scope and period it offers through an index: no scan of either effort table, nor of the rides', async () => {
    await seed(60);
    const plans: string[] = [];
    for (const scope of BOARD_SCOPES) {
      for (const period of BOARD_PERIODS) {
        const { statements } = await counted((store) =>
          createSegments({ store, now: () => 1_790_100_000_000 }).board(
            viewer,
            SEGMENT,
            new URLSearchParams({ scope, period }),
          ),
        );
        const reads = statements.filter((each) => each.includes('segment_effort'));
        expect(reads, `${scope} ${period}`).toHaveLength(1);
        const database = openDatabase(harness.path);
        try {
          // Unbound parameters are NULL to EXPLAIN: the plan, not the rows, is the point.
          const plan = (
            database.prepare(`EXPLAIN QUERY PLAN ${reads[0] ?? ''}`).all() as { detail: string }[]
          )
            .map((row) => row.detail)
            .join('\n');
          plans.push(plan);
          expect(plan, `${scope} ${period}`).not.toMatch(
            /SCAN (segment_effort|effort|activity_record|ride|athlete)\b/,
          );
          expect(plan, `${scope} ${period}`).toMatch(
            scope === 'personal' ? /INDEX segment_effort_own\b/ : /INDEX segment_effort_board\b/,
          );
        } finally {
          database.close();
        }
      }
    }
    expect(plans).toHaveLength(BOARD_SCOPES.length * BOARD_PERIODS.length);
  });
});

describe('an effort’s ride, deleted from the instance', () => {
  let harness: StoreHarness | undefined;
  afterEach(async () => {
    await harness?.destroy();
    harness = undefined;
  });

  it('takes its efforts with it, in the same statement', async () => {
    harness = await createStoreHarness();
    const content = activityRecordFixture('athlete-a', 'synced').contentSha256;
    await harness.write(async (store) => {
      await store.registerAthlete(registrationFixture('athlete-a'));
      await store.ingestActivity({
        athleteId: 'athlete-a',
        contentSha256: content,
        signedRecord: new Uint8Array([1]),
        recordSha256: 'f'.repeat(64),
        now: 1_790_000_000,
      });
      await store.setActivityVisibility('athlete-a', content, 'public');
      await store.publishSegment('athlete-a', {
        id: 'c'.repeat(32),
        name: 'S',
        sport: 'ride',
        distanceMetres: 500,
        definition: '{}',
        createdAt: 1,
      });
      expect(
        await store.replaceSegmentEfforts(
          'athlete-a',
          'c'.repeat(32),
          content,
          [
            {
              id: 'e1',
              startedAt: 10,
              elapsedSeconds: 60,
              visibility: 'public',
              excludedReason: null,
            },
          ],
          20,
        ),
      ).toBe('replaced');
    });
    expect(
      await harness.read((store) => store.listSegmentBoard('athlete-a', 'c'.repeat(32), 0, 50)),
    ).toHaveLength(1);
    await harness.write((store) => store.deleteSyncItem('athlete-a', 'activity', content, 30));
    expect(
      await harness.read((store) =>
        store.listOwnSegmentEfforts('athlete-a', 'c'.repeat(32), 0, 50),
      ),
    ).toEqual([]);
  });
});
