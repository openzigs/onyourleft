// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Leaderboard integrity on an instance, held to every one of #69's
 * criteria** — automatic exclusion of an impossible effort, the community
 * flag and its brakes, a hazardous segment, and the append-only record of
 * each — through the routes a device calls, sealed.
 */

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentHashOf,
  IMPLAUSIBLE_SPEED_METRES_PER_SECOND,
  implausibleEffort,
  MEASURED_DETECTION,
  metres,
  seconds,
  signActivityRecord,
} from '@onyourleft/domain';

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from '../auth/identity-testing.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import type { SegmentIntegrityLogEntry } from '../store/sql-store.ts';
import { claimsFor, longGpx } from '../sync/sync-testing.ts';
import { sha256Bytes, toBase64 } from '../sync/sync.ts';
import { definitionFixture, publish, RIDE_STARTED_AT } from './segments-testing.ts';
import {
  exclusionReason,
  FLAG_LIMIT,
  FLAGGED_SENTENCE,
  HAZARDOUS_SENTENCE,
  type Board,
} from './segments.ts';

interface Rider {
  readonly device: TestDevice;
  readonly token: string;
  readonly athleteId: string;
  readonly recoveryCodes: string[];
  readonly name: string;
}

let world: IdentityInstance;
let moderator: TestDevice;
let rideSeconds = 60;

beforeAll(async () => {
  moderator = await testDevice();
  world = await startIdentityInstance({
    bodyLimitBytes: 256 * 1024,
    moderators: { owner: moderator.publicKey },
  });
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

/** A synced ride of `who`'s, public here; answers its content hash. */
async function publicRide(who: Rider): Promise<string> {
  rideSeconds += 1;
  const bytes = longGpx(rideSeconds);
  const record = await signActivityRecord(
    {
      claims: claimsFor(`ride-${String(rideSeconds)}`),
      contentHash: await contentHashOf(bytes, sha256Bytes),
    },
    who.device.signingKey,
  );
  const answer = await world.call('POST', '/v1/sync/records', {
    token: who.token,
    body: { record, file: toBase64(bytes) },
  });
  if (answer.status !== 200) throw new Error(JSON.stringify(answer.body));
  const content = (answer.body as { contentSha256: string }).contentSha256;
  await world.call('POST', `/v1/sync/records/${content}/visibility`, {
    token: who.token,
    body: { visibility: 'public' },
  });
  return content;
}

async function share(who: Rider, segmentId: string, content: string, elapsedSeconds: number) {
  return world.call('POST', `/v1/segments/${segmentId}/efforts/${content}`, {
    token: who.token,
    body: {
      efforts: [{ startedAt: RIDE_STARTED_AT + 60, elapsedSeconds, visibility: 'public' }],
    },
  });
}

async function onTheBoard(name: string, segmentId: string, elapsedSeconds: number) {
  const who = await rider(name);
  const content = await publicRide(who);
  expect((await share(who, segmentId, content, elapsedSeconds)).status).toBe(200);
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

let segmentNumber = 0;
async function segmentBy(who: Rider): Promise<string> {
  segmentNumber += 1;
  return publish(world, who.token, definitionFixture(`Hill ${String(segmentNumber)}`));
}

/** The integrity log, read on a store the instance's own connection did not serve. */
async function logOf(segmentId: string): Promise<SegmentIntegrityLogEntry[]> {
  const store = await openSqlStore(world.path);
  try {
    return (await store.listSegmentIntegrityLog(undefined, 1_000)).filter(
      (entry) => entry.segmentId === segmentId,
    );
  } finally {
    await store.close();
  }
}

function flagEffort(who: Rider, segmentId: string, effortId: string, reason = 'vehicle') {
  return world.call('POST', `/v1/segments/${segmentId}/efforts/${effortId}/flag`, {
    token: who.token,
    body: { reason },
  });
}

/** The definition's path is about 555 m: this many seconds is ~55 m/s, a car on a motorway or worse. */
const IMPOSSIBLE_SECONDS = 10;

describe('automatic exclusion (#69’s first and second criteria)', () => {
  it('keeps an impossible effort off every shared board, and shows it to its rider with the reason', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    await onTheBoard('Bea', segmentId, 300);
    const cy = await onTheBoard('Cy', segmentId, IMPOSSIBLE_SECONDS);

    expect(names(await board(ann, segmentId))).toEqual(['Bea']);
    expect(names(await board(cy, segmentId))).toEqual(['Bea']);
    const own = (await board(cy, segmentId, '?scope=personal')).rows;
    expect(own).toHaveLength(1);
    expect(own[0]?.rank).toBeNull();
    expect(own[0]?.excluded).toMatch(
      /^Excluded automatically: \d+\.\d m\/s averaged over the segment, faster than the 27\.8 m\/s a ride can go\.$/,
    );

    // The control: the same rider, the same segment, a possible time — ranked.
    await share(cy, segmentId, cy.content, 280);
    expect(names(await board(ann, segmentId))).toEqual(['Cy', 'Bea']);
    expect((await board(cy, segmentId, '?scope=personal')).rows[0]).toMatchObject({
      rank: 1,
      excluded: null,
    });
  });

  it('records the exclusion in the log: no actor, its rider, its effort, the reason, the time', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const cy = await onTheBoard('Cy', segmentId, IMPOSSIBLE_SECONDS);
    const [entry] = await logOf(segmentId);
    const effortId = (await board(cy, segmentId, '?scope=personal')).rows[0]?.effortId;
    expect(entry).toMatchObject({
      action: 'excluded',
      actorAthleteId: null,
      subjectAthleteId: cy.athleteId,
      segmentId,
      effortId,
      at: Math.floor(world.clock.ms / 1000),
    });
    expect(entry?.reason).toMatch(/^Excluded automatically/);
  });

  it('judges with the domain’s rule, against the length the instance measured', () => {
    for (const sport of ['ride', 'run'] as const) {
      const ceiling = IMPLAUSIBLE_SPEED_METRES_PER_SECOND[sport];
      for (const elapsed of [10, 100 / ceiling, 1000 / ceiling, 60]) {
        expect(exclusionReason(sport, 1000, elapsed) !== null, `${sport} ${String(elapsed)}`).toBe(
          implausibleEffort(sport, metres(1000), seconds(elapsed)) !== undefined,
        );
      }
    }
  });
});

describe('the community flag (#69’s fourth to sixth criteria)', () => {
  it('is refused from a rider with no effort of their own on the segment, and changes nothing', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const effortId = (await board(bea, segmentId)).rows[0]?.effortId ?? '';
    const drive = await rider('Drive-by');
    const refused = await flagEffort(drive, segmentId, effortId);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('an effort of their own on this segment');
    expect(names(await board(ann, segmentId))).toEqual(['Bea']);
    expect(await logOf(segmentId)).toEqual([]);

    // The control: once the same rider has an effort there, the flag is taken.
    const content = await publicRide(drive);
    await share(drive, segmentId, content, 320);
    expect((await flagEffort(drive, segmentId, effortId)).body).toEqual({ flagged: true });
    expect(names(await board(ann, segmentId))).toEqual(['Drive-by']);
  });

  it('takes a flagged effort off every shared board, leaves its ride byte for byte, and tells its rider', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const annRide = await publicRide(ann);
    await share(ann, segmentId, annRide, 330);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const effortId = (await board(ann, segmentId)).rows.find((row) => !row.yours)?.effortId ?? '';
    const before = await Promise.all(
      [`/v1/activities/${bea.content}`, `/v1/sync/records/${bea.content}`].map(async (path) =>
        (await world.request('GET', path, { token: bea.token })).text(),
      ),
    );

    expect((await flagEffort(ann, segmentId, effortId, 'impossible-time')).body).toEqual({
      flagged: true,
    });

    expect(names(await board(ann, segmentId))).toEqual(['Ann']);
    expect(names(await board(bea, segmentId))).toEqual(['Ann']);
    expect((await board(bea, segmentId, '?scope=personal')).rows).toEqual([
      expect.objectContaining({ rank: null, excluded: FLAGGED_SENTENCE, elapsedSeconds: 300 }),
    ]);
    const after = await Promise.all(
      [`/v1/activities/${bea.content}`, `/v1/sync/records/${bea.content}`].map(async (path) =>
        (await world.request('GET', path, { token: bea.token })).text(),
      ),
    );
    expect(after).toEqual(before);
    expect(after[0]).toContain(bea.content);

    // Recorded: the flagger, whose it was, the effort, the reason, the time.
    expect(await logOf(segmentId)).toEqual([
      expect.objectContaining({
        action: 'flagged_effort',
        actorAthleteId: ann.athleteId,
        subjectAthleteId: bea.athleteId,
        effortId,
        reason: 'impossible-time',
        at: Math.floor(world.clock.ms / 1000),
      }),
    ]);
    // Flagging it again raises nothing new.
    expect((await flagEffort(ann, segmentId, effortId)).body).toEqual({ flagged: false });
    expect(await logOf(segmentId)).toHaveLength(1);
  });

  it('answers a flag on the caller’s own effort, another segment’s, or a rider who blocked them as on none', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const other = await segmentBy(ann);
    const annRide = await publicRide(ann);
    await share(ann, segmentId, annRide, 330);
    const bea = await onTheBoard('Bea', segmentId, 300);
    await share(bea, other, bea.content, 300);
    const rows = (await board(ann, segmentId)).rows;
    const mine = rows.find((row) => row.yours)?.effortId ?? '';
    const theirs = rows.find((row) => !row.yours)?.effortId ?? '';
    const nobody = await flagEffort(ann, segmentId, 'f'.repeat(32));
    expect(nobody.status).toBe(404);
    expect(await flagEffort(ann, segmentId, mine)).toEqual(nobody);
    expect(await flagEffort(ann, other, theirs)).toEqual(
      // On `other` Ann has no effort: refused for that first.
      expect.objectContaining({ status: 400 }),
    );
    await world.call('POST', `/v1/blocks/${ann.athleteId}`, { token: bea.token });
    expect(await flagEffort(ann, segmentId, theirs)).toEqual(nobody);
    expect(await logOf(segmentId)).toEqual([]);
  });

  it(`is limited to ${String(FLAG_LIMIT.limit)} a day per rider, counted from the flags themselves`, async () => {
    const flagger = await rider('Flagger');
    const content = await publicRide(flagger);
    const segments: string[] = [];
    for (let index = 0; index <= FLAG_LIMIT.limit; index += 1) {
      const segmentId = await segmentBy(flagger);
      await share(flagger, segmentId, content, 300);
      segments.push(segmentId);
    }
    for (const segmentId of segments.slice(0, FLAG_LIMIT.limit)) {
      const taken = await world.call('POST', `/v1/segments/${segmentId}/hazard`, {
        token: flagger.token,
        body: { reason: 'traffic' },
      });
      expect(taken.body).toEqual({ flagged: true });
    }
    const last = segments.at(-1) ?? '';
    const refused = await world.call('POST', `/v1/segments/${last}/hazard`, {
      token: flagger.token,
      body: { reason: 'traffic' },
    });
    expect(refused.status).toBe(429);
    expect((await board(flagger, last)).hazardous).toBe(false);
    expect(await logOf(last)).toEqual([]);
    // A day on, the window has passed (a fresh sign-in: a session lasts less).
    world.clock.ms += (FLAG_LIMIT.windowSeconds + 1) * 1000;
    const again = await world.signIn(flagger.device);
    const token = again.body.sessionToken as string;
    expect(
      (
        await world.call('POST', `/v1/segments/${last}/hazard`, {
          token,
          body: { reason: 'traffic' },
        })
      ).body,
    ).toEqual({ flagged: true });
  });

  it('refuses a reason outside the closed list, naming the field', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const content = await publicRide(ann);
    await share(ann, segmentId, content, 300);
    for (const reason of ['because', '', 7]) {
      const answer = await world.call('POST', `/v1/segments/${segmentId}/hazard`, {
        token: ann.token,
        body: { reason },
      });
      expect(answer.status).toBe(400);
      expect(JSON.stringify(answer.body)).toContain('"field":"reason"');
    }
  });

  it('gives a flagged effort back when its flagger erases their account; the record stays', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const bea = await onTheBoard('Bea', segmentId, 300);
    const effortId = (await board(ann, segmentId)).rows[0]?.effortId ?? '';
    const flagger = await rider('Flagger');
    await share(flagger, segmentId, await publicRide(flagger), 320);
    await flagEffort(flagger, segmentId, effortId);
    expect(names(await board(ann, segmentId))).toEqual(['Flagger']);
    await world.call('DELETE', '/v1/account', {
      token: flagger.token,
      body: { recoveryCode: flagger.recoveryCodes[0] },
    });
    expect(names(await board(ann, segmentId))).toEqual(['Bea']);
    expect(await logOf(segmentId)).toEqual([
      expect.objectContaining({ action: 'flagged_effort', actorAthleteId: flagger.athleteId }),
    ]);
    void bea;
  });
});

describe('a hazardous segment (#69’s seventh criterion)', () => {
  it('awards nothing on it — no board, no first place, no personal best — and records who said so', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    const annRide = await publicRide(ann);
    await share(ann, segmentId, annRide, 250);
    const bea = await onTheBoard('Bea', segmentId, 300);
    expect((await board(ann, segmentId, '?scope=personal')).rows[0]?.rank).toBe(1);

    const flagged = await world.call('POST', `/v1/segments/${segmentId}/hazard`, {
      token: bea.token,
      body: { reason: 'junction' },
    });
    expect(flagged.body).toEqual({ flagged: true });

    for (const who of [ann, bea]) {
      const shared = await board(who, segmentId);
      expect(shared.hazardous).toBe(true);
      expect(shared.rows).toEqual([]);
      const own = await board(who, segmentId, '?scope=personal');
      expect(own.rows.length).toBeGreaterThan(0);
      for (const row of own.rows) {
        expect(row.rank).toBeNull();
        expect(row.excluded).toBe(HAZARDOUS_SENTENCE);
      }
    }
    const listed = (await world.call('GET', '/v1/segments?limit=200', { token: ann.token }))
      .body as { items: { segmentId: string }[] };
    expect(listed.items.some((each) => each.segmentId === segmentId)).toBe(true);
    expect(await logOf(segmentId)).toEqual([
      expect.objectContaining({
        action: 'flagged_hazardous',
        actorAthleteId: bea.athleteId,
        subjectAthleteId: null,
        effortId: null,
        reason: 'junction',
      }),
    ]);
  });
});

describe('the moderators read the log (#69’s eighth criterion)', () => {
  it('serves it to a moderator, and to nobody else, as though it were not there', async () => {
    const ann = await rider('Ann');
    const segmentId = await segmentBy(ann);
    await onTheBoard('Cy', segmentId, IMPOSSIBLE_SECONDS);
    const plain = await world.call('GET', '/v1/moderation/segment-log', { token: ann.token });
    expect(plain.status).toBe(404);
    const session = await world.signIn(moderator);
    const read = await world.call('GET', '/v1/moderation/segment-log?limit=200', {
      token: session.body.sessionToken as string,
    });
    expect(read.status).toBe(200);
    const items = (read.body as { items: { segmentId: string; action: string }[] }).items;
    expect(items.filter((each) => each.segmentId === segmentId).map((each) => each.action)).toEqual(
      ['excluded'],
    );
  });
});

describe('the rule as docs/leaderboard-integrity.md states it (#69’s first and third criteria)', () => {
  const doc = readFileSync(
    new URL('../../../../docs/leaderboard-integrity.md', import.meta.url),
    'utf8',
  ).replace(/\s+/g, ' ');

  it('states each threshold the code applies, and the measured detection rate', () => {
    expect(doc).toContain(`${String(IMPLAUSIBLE_SPEED_METRES_PER_SECOND.ride)} m/s`);
    expect(doc).toContain(`${String(IMPLAUSIBLE_SPEED_METRES_PER_SECOND.run)} m/s`);
    expect(doc).toContain(
      `${String(MEASURED_DETECTION.caught)} of the ${String(MEASURED_DETECTION.impossible)} impossible efforts`,
    );
    expect(doc).toContain(
      `${String(MEASURED_DETECTION.falselyExcluded)} of the ${String(MEASURED_DETECTION.genuine)} genuine ones`,
    );
    expect(doc).toContain(`${String(FLAG_LIMIT.limit)} flags a day`);
  });
});
