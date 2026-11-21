// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's sex and year of birth (#2432) never leave the device except in
 * their own account export — the owner's ruling of 2026-11-09 on #2430.
 *
 * **And the rider drawn (`riderBody`, #2839) with them**: since the owner's
 * ruling of 2026-11-20 it is the same word as the calorie sex, so sending it
 * sends the sex. The owner's room-privacy ruling of the same day is that it
 * may leave **only through the multiplayer room path that shows other riders
 * your rider**, as any game avatar is shown; nothing else of the calorie
 * inputs ever does.
 *
 * ⚠️ **No room sends the rider today.** `net/room-session.ts` and the room
 * wire format (`packages/protocol`) carry no rider, so this guard admits no
 * path at all. The rooms lane that sends it admits its one module here, for
 * `riderBody` only, in the change that sends it — `calorieSex` and `birthYear`
 * stay admitted nowhere.
 *
 * Two halves, each with its limit stated:
 *
 * - **By behaviour**: the ride-analysis input, which an instance's write-up
 *   (`ride-analysis/instance-analysis.ts`) and a synced ride summary
 *   (`ride-analysis/ride-summary.ts`) are both built from, is read through
 *   the real store for a rider who has chosen a rider and set a year, and
 *   carries none of the three. The sync bodies themselves are held in
 *   `instance/sync.test.ts` §"the calorie inputs never leave the device
 *   through a sync".
 * - **By source**: no module that builds an instance-bound, room-bound or
 *   model-bound body — instance analysis, sync, ride write-ups, camera
 *   uploads, re-plan jobs, rooms and their wire format — names any of the
 *   three fields. This is what catches a future body that reads the row and
 *   copies them, which no behavioural test written today can foresee; it
 *   cannot catch a spread of the whole athlete row, which the behavioural half
 *   and `export-everything.ts`' named-fields rule are for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unixSeconds } from '@onyourleft/domain';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRideInput } from '../ride-analysis/read-input';

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

describe('the calorie inputs stay on the device (#2432)', () => {
  it('are in no ride-analysis input, which a write-up and a synced summary are built from', async () => {
    const ride = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
    await harness.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
      await store.setAthleteRider(ATHLETE_A, 'female');
      await store.setAthleteBirthYear(ATHLETE_A, 1985);
    });

    const input = await harness.read(async (store) =>
      readRideInput(store, ATHLETE_A, ride.id, { templateVersion: 't', cameraConsented: true }),
    );
    expect(input).toBeDefined();
    const sent = JSON.stringify(input);
    expect(sent).not.toContain('calorieSex');
    expect(sent).not.toContain('birthYear');
    expect(sent).not.toContain('riderBody');
    expect(sent).not.toContain('female');
    expect(sent).not.toContain('1985');
  });

  it('are named by no module that builds a body for an instance, a room or a model', () => {
    const offenders: string[] = [];
    for (const root of BODY_ROOTS) {
      for (const file of sources(root)) {
        if (FIELDS.test(readFileSync(file, 'utf8'))) offenders.push(relative(HERE, file));
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('every module that reaches an instance or a room is under a root the scan reads', () => {
    // So a new sender in a directory nobody listed is red here rather than
    // unscanned. `main.tsx` composes the ports and builds no body.
    const scanned = (file: string): boolean => BODY_ROOTS.some((root) => file.startsWith(root));
    const outside: string[] = [];
    for (const file of sources(join(HERE, '..'))) {
      if (scanned(file) || relative(join(HERE, '..'), file) === 'main.tsx') continue;
      if (SENDS.test(readFileSync(file, 'utf8'))) outside.push(relative(join(HERE, '..'), file));
    }
    expect(outside).toStrictEqual([]);
  });

  it('the scan is red for a body that names the rider drawn', () => {
    expect(FIELDS.test('const body = { riderBody: athlete.riderBody };')).toBe(true);
    expect(FIELDS.test('const body = { calorieSex };')).toBe(true);
    expect(FIELDS.test('const body = { birthYear };')).toBe(true);
    expect(FIELDS.test('const body = { kitColour };')).toBe(false);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));

/** The three fields, which are one health input since 2026-11-20. */
const FIELDS = /\b(calorieSex|birthYear|riderBody)\b/;

/** Where a body bound for an instance, a room or a model is built. */
const BODY_ROOTS = [
  join(HERE, '..', 'instance'),
  join(HERE, '..', 'net'),
  join(HERE, '..', 'rooms'),
  join(HERE, '..', 'ride-analysis'),
  join(HERE, '..', 'camera'),
  join(HERE, '..', 'workout'),
  join(HERE, '..', 'game', 'lap-race'),
  join(HERE, '..', 'game', 'room-ride.ts'),
  join(HERE, '..', 'game', 'hud', 'RoomReport.tsx'),
  join(HERE, '..', 'detail', 'write-up.ts'),
  join(HERE, '..', '..', '..', '..', 'packages', 'analysis', 'src'),
  join(HERE, '..', '..', '..', '..', 'packages', 'protocol', 'src'),
];

/**
 * A value import of the one instance transport (#777), the room session or the
 * room wire format. A type-only import sends nothing, so GameView and the HUD,
 * which draw a room, are not senders.
 */
const SENDS =
  /\bimport\s+(?!type\b)[^;]*?from '[^']*(instance-transport|net\/room-session|@onyourleft\/protocol)'/;

function* sources(dir: string): Generator<string> {
  if (/\.tsx?$/.test(dir)) {
    yield dir;
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}
